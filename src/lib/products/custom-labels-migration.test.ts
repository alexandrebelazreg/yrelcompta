import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalLabel, defaultMaterialColors, defaultProductCategories, mergeLabelOptions } from "./labels";
import { materialSchema, productSchema } from "./validation";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261014120000_custom_categories_material_colors.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");

describe("migration catégories et couleurs personnalisables", () => {
  it("convertit les catégories existantes en libellés français puis supprime l’enum", () => {
    expect(sql).toContain("alter column category type text");
    expect(migration).toContain("when 'earrings' then 'Boucles d’oreilles'");
    expect(sql.indexOf("drop type public.product_category")).toBeGreaterThan(sql.indexOf("alter column category type text"));
  });

  it("borne les libellés et ajoute une couleur facultative aux matières", () => {
    expect(sql).toContain("char_length(category) between 1 and 60");
    expect(sql).toContain("add column color text");
    expect(sql).toContain("char_length(color) between 1 and 60");
  });

  it("garde la validation de recette avant toute écriture produit", () => {
    const save = sql.slice(sql.indexOf("create function public.save_product_with_recipe"), sql.indexOf("revoke all on function"));
    const validation = save.indexOf("perform public.validate_product_recipe");
    expect(validation).toBeGreaterThan(0);
    expect(save.indexOf("insert into public.products")).toBeGreaterThan(validation);
    expect(save.indexOf("delete from public.product_materials")).toBeGreaterThan(validation);
  });

  it("vérifie l’entreprise avant de créer un fournisseur depuis une matière", () => {
    const create = sql.slice(sql.indexOf("create function public.create_material"), sql.indexOf("create function public.update_material"));
    expect(create.indexOf("assert_product_manager")).toBeLessThan(create.indexOf("resolve_material_supplier"));
    expect(sql).toContain("return public.create_supplier(p_business_id");
  });

  it("n’expose pas les fonctions internes et révoque anon", () => {
    expect(sql).toContain("public.resolve_material_supplier(uuid,uuid,text) from public,anon,authenticated");
    const grant = sql.slice(sql.indexOf("grant execute on function"));
    expect(grant).not.toContain("resolve_material_supplier");
    expect(grant).not.toContain("canonical_");
    expect(migration).not.toContain("service_role");
    expect(migration).not.toMatch(/create policy .* for (insert|update|delete|all)/i);
  });
});

describe("libellés personnalisables", () => {
  it("réutilise la casse d’un libellé connu", () => {
    expect(canonicalLabel("  doré ", defaultMaterialColors)).toBe("Doré");
    expect(canonicalLabel("Chaîne  de cheville", defaultProductCategories)).toBe("Chaîne de cheville");
  });

  it("fusionne les libellés par défaut et ceux créés, sans doublon", () => {
    expect(mergeLabelOptions(["Argent", "Doré"], ["Or rose", "argent", null, "Bronze"])).toEqual(["Argent", "Doré", "Bronze", "Or rose"]);
  });

  it("accepte une catégorie créée et refuse un fournisseur ambigu", () => {
    const product = productSchema.safeParse({ name: "Bijou", sku: "", category: "chaîne de cheville", salePrice: "10", laborMinutes: "0", packagingCost: "", materialLossPercent: "0", notes: "", isActive: true });
    expect(product.success && product.data.category).toBe("chaîne de cheville");
    const material = materialSchema.safeParse({ name: "Perle", internalReference: "", supplierId: "00000000-0000-4000-8000-000000000000", newSupplierName: "Perles & Co", color: "", unit: "piece", packageQuantity: "10", packageCost: "5", notes: "", isActive: true });
    expect(material.success).toBe(false);
  });
});
