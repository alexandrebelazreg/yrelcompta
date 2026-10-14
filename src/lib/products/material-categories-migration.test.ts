import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { materialCategorySchema, materialSchema } from "./validation";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261014180000_material_categories.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");

describe("migration catégories de matières", () => {
  it("crée une table isolée par entreprise, sous RLS et sans écriture directe", () => {
    expect(migration.match(/^create table public\./gm)).toHaveLength(1);
    expect(sql).toContain("alter table public.material_categories enable row level security");
    expect(sql).toContain("revoke all on table public.material_categories from anon,authenticated");
    expect(migration).not.toMatch(/create policy .* for (insert|update|delete|all)/i);
    expect(sql).toContain("foreign key(category_id,business_id) references public.material_categories(id,business_id)");
  });

  it("rend nom et préfixe uniques par entreprise", () => {
    expect(sql).toContain("material_categories(business_id,lower(name))");
    expect(sql).toContain("material_categories(business_id,reference_prefix)");
    expect(sql).toContain("reference_prefix ~ '^[A-Z0-9]{1,10}$'");
  });

  it("vérifie l’entreprise avant de créer une catégorie depuis une matière", () => {
    const create = sql.slice(sql.indexOf("create function public.create_material"), sql.indexOf("create function public.update_material("));
    expect(create.indexOf("assert_product_manager")).toBeLessThan(create.indexOf("resolve_material_category"));
    expect(sql).toContain("update_material_category(p_category_id uuid,p_business_id uuid,p_name text,p_reference_prefix text) returns void language plpgsql security definer set search_path='' as $$ declare actor uuid:=public.assert_product_manager(p_business_id)");
  });

  it("n’expose pas les fonctions internes", () => {
    expect(sql).toContain("public.resolve_material_category(uuid,uuid,text,text) from public,anon,authenticated");
    const grant = sql.slice(sql.indexOf("grant execute on function"));
    expect(grant).not.toContain("resolve_material_category");
    expect(migration).not.toContain("service_role");
  });
});

describe("validation des catégories de matières", () => {
  const base = { name: "Chaîne", internalReference: "", categoryId: "", supplierId: "", newSupplierName: "", color: "", unit: "piece", packageQuantity: "1", packageCost: "2", notes: "", isActive: true };

  it("normalise le préfixe d’une nouvelle catégorie", () => {
    const parsed = materialSchema.safeParse({ ...base, newCategoryName: "Chaîne principale", newCategoryPrefix: " cp " });
    expect(parsed.success && parsed.data.newCategoryPrefix).toBe("CP");
  });

  it("exige un préfixe pour une nouvelle catégorie et refuse un choix ambigu", () => {
    expect(materialSchema.safeParse({ ...base, newCategoryName: "Chaîne principale", newCategoryPrefix: "--" }).success).toBe(false);
    expect(materialSchema.safeParse({ ...base, categoryId: "00000000-0000-4000-8000-000000000000", newCategoryName: "Autre", newCategoryPrefix: "AU" }).success).toBe(false);
  });

  it("valide la modification d’une catégorie", () => {
    expect(materialCategorySchema.safeParse({ categoryId: "00000000-0000-4000-8000-000000000000", name: "Chaîne secondaire", referencePrefix: "cs" }).success).toBe(true);
    expect(materialCategorySchema.safeParse({ categoryId: "00000000-0000-4000-8000-000000000000", name: "", referencePrefix: "CS" }).success).toBe(false);
  });
});
