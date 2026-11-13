import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261113120000_shopify_order_import.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");
const fn = (name: string) => sql.slice(sql.indexOf(`create function public.${name}(`), sql.indexOf("end $$;", sql.indexOf(`create function public.${name}(`)));

describe("migration d’import des commandes Shopify", () => {
  it("crée deux tables isolées par entreprise, en lecture seule sous RLS", () => {
    expect(migration.match(/^create table public\./gm)).toHaveLength(2);
    expect(migration.match(/enable row level security/g)).toHaveLength(2);
    expect(sql).toContain("revoke all on table public.shopify_order_imports, public.shopify_product_links from anon, authenticated");
    expect(migration).not.toMatch(/create policy .* for (insert|update|delete|all)/i);
    expect(sql).toContain("foreign key (sale_id, business_id) references public.sales(id, business_id)");
    expect(sql).toContain("foreign key (product_id, business_id) references public.products(id, business_id)");
  });

  it("crée les ventes uniquement via les RPC existantes de l’application", () => {
    const apply = fn("shopify_apply_order");
    for (const rpc of ["create_sale_draft", "update_sale_draft", "validate_sale", "record_payment", "delete_sale_draft"]) expect(apply).toContain(`public.${rpc}(`);
    expect(apply).not.toMatch(/insert into public\.sales|update public\.sales|insert into public\.payments|insert into public\.sale_items/);
  });

  it("ne modifie jamais une vente validée", () => {
    const apply = fn("shopify_apply_order");
    const guard = apply.indexOf("existing.status <> 'draft'");
    expect(guard).toBeGreaterThan(0);
    expect(apply.indexOf("public.update_sale_draft(")).toBeGreaterThan(guard);
  });

  it("ne valide que lorsque produits, totaux et TVA sont fiables", () => {
    const apply = fn("shopify_apply_order");
    expect(apply).toContain("if not (flags && array['unlinked_products', 'tax_present', 'total_mismatch']) then perform public.validate_sale(");
  });

  it("vérifie l’appartenance de l’acteur avant d’agir en son nom, côté serveur uniquement", () => {
    const service = fn("shopify_import_order");
    expect(service.indexOf("assert_shopify_actor_manager")).toBeGreaterThan(0);
    expect(service.indexOf("set_config('request.jwt.claims'")).toBeGreaterThan(service.indexOf("assert_shopify_actor_manager"));
    expect(sql).toContain("revoke all on function public.shopify_import_order(uuid, uuid, jsonb, text), public.mark_shopify_webhook_event(uuid, text, public.shopify_webhook_processing_status, text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.shopify_import_order(uuid, uuid, jsonb, text), public.mark_shopify_webhook_event(uuid, text, public.shopify_webhook_processing_status, text) to service_role");
    expect(sql).toContain("revoke all on function public.resolve_shopify_line_product(uuid, text, text, text), public.shopify_apply_order(uuid, uuid, jsonb, text) from public, anon, authenticated");
    expect(migration.match(/set_config\(/g)).toHaveLength(2);
  });

  it("vérifie l’entreprise pour les actions de l’utilisatrice", () => {
    for (const name of ["shopify_apply_order", "link_shopify_product", "reprocess_shopify_order_import", "dismiss_shopify_import_attention"]) {
      expect(fn(name), name).toContain("public.can_manage_business(p_business_id)");
    }
  });

  it("ajoute les signalements avec array_append (un littéral concaténé serait lu comme un tableau)", () => {
    expect(migration).not.toMatch(/flags \|\| '/);
    expect(migration.match(/array_append\(flags, '/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("n’enregistre aucune coordonnée cliente dans l’instantané de commande", () => {
    expect(migration).not.toMatch(/email|phone|address/i);
    expect(migration).not.toContain("service_role')");
  });
});
