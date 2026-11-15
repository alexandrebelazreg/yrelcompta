import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261115120000_shopify_dedup_autolink.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");
const apply = sql.slice(sql.indexOf("create or replace function public.shopify_apply_order("), sql.indexOf("create function public.shopify_relink_on_product_change"));

describe("commandes Shopify : doublons et rattachement automatique", () => {
  it("cherche une vente existante portant le numéro avant toute création", () => {
    expect(apply.indexOf("public.find_existing_shopify_sale(")).toBeGreaterThan(0);
    expect(apply.indexOf("public.find_existing_shopify_sale(")).toBeLessThan(apply.indexOf("public.create_sale_draft("));
    expect(sql).toContain("s.status <> 'cancelled'");
    expect(sql).toContain("not exists (select 1 from public.shopify_order_imports i where i.sale_id = s.id and i.id <> p_import_id)");
    expect(sql).toContain("'(^|[^0-9A-Za-z])'");
  });

  it("ne crée rien quand plusieurs ventes portent le numéro", () => {
    expect(apply).toContain("if matches > 1 then update public.shopify_order_imports set status = 'needs_review', attention = array['possible_duplicate']");
  });

  it("ne modifie ni ne supprime jamais une vente existante rattachée", () => {
    expect(apply).toContain("existing.status = 'draft' and not matched then perform public.delete_sale_draft(");
    expect(apply.indexOf("(existing.status <> 'draft' or matched)")).toBeLessThan(apply.indexOf("public.update_sale_draft("));
  });

  it("relance les brouillons en fin de transaction, sans jamais bloquer l’enregistrement d’un produit", () => {
    expect(sql).toContain("create constraint trigger products_shopify_relink after insert or update of name, sku, is_active on public.products deferrable initially deferred");
    expect(sql).toContain("exception when others then raise warning");
    expect(sql).toContain("auth.uid() is null or not public.can_manage_business(new.business_id)");
  });

  it("rattache par SKU puis par nom, seulement si un produit unique correspond", () => {
    expect(sql).toMatch(/lower\(p\.sku\) = lower\(btrim\(p_sku\)\) having count\(\*\) = 1/);
    expect(sql).toMatch(/lower\(btrim\(p\.name\)\) = lower\(base_title\) having count\(\*\) = 1/);
  });

  it("n’expose aucune nouvelle fonction et n’ajoute aucun droit", () => {
    expect(sql).toContain("revoke all on function public.find_existing_shopify_sale(uuid, text, uuid), public.resolve_shopify_line_product(uuid, text, text, text, text), public.shopify_apply_order(uuid, uuid, jsonb, text), public.shopify_relink_on_product_change() from public, anon, authenticated");
    expect(migration).not.toMatch(/^grant /im);
    expect(migration).not.toContain("service_role");
  });
});
