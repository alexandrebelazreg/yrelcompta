import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saleItemSchema } from "./validation";

const root = process.cwd();
const migrationPath = join(root, "supabase/migrations/20260807010000_sales_product_snapshots.sql");
const sql = readFileSync(migrationPath, "utf8");
const form = readFileSync(join(root, "src/components/sales/sale-form.tsx"), "utf8");
const detail = readFileSync(join(root, "src/app/(app)/ventes/[id]/page.tsx"), "utf8");
const costDisplay = readFileSync(join(root, "src/components/sales/manufacturing-cost-display.tsx"), "utf8");
const queries = readFileSync(join(root, "src/lib/sales/queries.ts"), "utf8");
const actions = readFileSync(join(root, "src/lib/sales/actions.ts"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function functionSql(name: string, nextMarker: string): string {
  return sql.slice(sql.indexOf(`function public.${name}`), sql.indexOf(nextMarker, sql.indexOf(`function public.${name}`)));
}

describe("contrat des lignes de brouillon", () => {
  it("accepte une ligne sans produit", () => expect(saleItemSchema.safeParse({ description: "Création libre", quantity: 1, unitPrice: "10,00", productId: null }).success).toBe(true));
  it("accepte une ligne avec produit", () => expect(saleItemSchema.safeParse({ description: "Bague", quantity: 1, unitPrice: "25", productId: "123e4567-e89b-12d3-a456-426614174000" }).success).toBe(true));
  it("accepte product_id absent pour compatibilité", () => expect(saleItemSchema.safeParse({ description: "Ancienne ligne", quantity: 1, unitPrice: "12" }).success).toBe(true));
  it("refuse un UUID produit invalide", () => expect(saleItemSchema.safeParse({ description: "Bague", quantity: 1, unitPrice: "25", productId: "invalide" }).success).toBe(false));
  it("refuse un identifiant produit vide", () => expect(saleItemSchema.safeParse({ description: "Bague", quantity: 1, unitPrice: "25", productId: "" }).success).toBe(false));
  it("refuse les propriétés inattendues", () => expect(saleItemSchema.safeParse({ description: "Bague", quantity: 1, unitPrice: "25", unexpected: true }).success).toBe(false));
});

describe("migration des snapshots de vente", () => {
  it("est l'unique nouvelle migration au timestamp demandé", () => {
    const migrations = readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql"));
    expect(migrations.at(-1)).toBe("20260807010000_sales_product_snapshots.sql");
    expect(migrations.filter((name) => name > "20260806210000_products_costing.sql")).toEqual(["20260807010000_sales_product_snapshots.sql"]);
  });
  it("ne contient aucun script appliquant la migration", () => expect(packageJson).not.toContain("supabase db push"));
  it("ajoute l'association produit isolée par entreprise avec suppression interdite", () => {
    expect(sql).toContain("foreign key (product_id, business_id)");
    expect(sql).toContain("references public.products(id, business_id) on delete restrict");
    expect(sql).toContain("sale_items_business_product_sale_idx");
  });
  it("garde tous les snapshots nuls dans un brouillon", () => {
    const createDraft = functionSql("create_sale_draft", "create or replace function public.update_sale_draft");
    expect(createDraft).not.toContain("unit_manufacturing_cost_cents =");
    expect(createDraft).not.toContain("product_name_snapshot");
  });
  it("enregistre product_id dans les deux RPC de brouillon", () => {
    expect(functionSql("create_sale_draft", "create or replace function public.update_sale_draft")).toContain("product_id, position");
    expect(functionSql("update_sale_draft", "create or replace function public.validate_sale")).toContain("product_id, position");
  });
  it("rejette un produit d'une autre entreprise avec un code stable", () => expect(sql).toContain("PRODUCT_BUSINESS_FORBIDDEN"));
  it("rejette un produit introuvable avec un code stable", () => expect(sql).toContain("PRODUCT_NOT_FOUND"));
  it("accepte un produit archivé appartenant à l'entreprise", () => expect(functionSql("assert_sale_item_products", "create or replace function public.create_sale_draft")).not.toContain("is_active"));
  it("calcule les matières rationnellement avant un arrondi unique", () => {
    const costing = functionSql("calculate_product_costing_internal", "revoke all on function public.calculate_product_costing_internal");
    expect(costing).toContain("sum(");
    expect(costing).toContain("raw_rounded := round(raw_exact)");
  });
  it("calcule pertes, main-d'œuvre et emballage selon les paramètres courants", () => {
    const costing = functionSql("calculate_product_costing_internal", "revoke all on function public.calculate_product_costing_internal");
    expect(costing).toContain("material_loss_basis_points");
    expect(costing).toContain("labor_minutes::numeric * hourly_rate / 60");
    expect(costing).toContain("coalesce(product_record.packaging_cost_cents::numeric, default_packaging)");
  });
  it("réutilise le calcul interne dans get_product_costing", () => expect(functionSql("get_product_costing", "revoke all on function public.get_product_costing")).toContain("calculate_product_costing_internal"));
  it("fige le coût au moment de validate_sale", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation).toContain("cross join lateral public.calculate_product_costing_internal");
    expect(validation).toContain("update public.sale_items item set");
  });
  it("calcule une seule fois chaque produit dans le même snapshot transactionnel", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation).toContain("select distinct product_id");
    expect(validation).toContain("product_costs as materialized");
  });
  it("fige le nom et le SKU du produit", () => {
    expect(sql).toContain("product_name_snapshot = product_costs.name");
    expect(sql).toContain("product_sku_snapshot = product_costs.sku");
  });
  it("conserve le prix réellement saisi", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation).not.toMatch(/unit_price_cents\s*=/);
  });
  it("fige séparément matières, pertes, main-d'œuvre et emballage", () => {
    for (const column of ["unit_raw_materials_cost_cents", "unit_material_loss_cost_cents", "unit_labor_cost_cents", "unit_packaging_cost_cents"]) expect(sql).toContain(`${column} = product_costs`);
  });
  it.each([
    "une modification ultérieure du produit",
    "une modification ultérieure d'une matière",
    "une modification ultérieure du taux horaire",
    "une modification ultérieure de l'emballage par défaut",
  ])("préserve les snapshots après %s", () => {
    expect(functionSql("protect_sale_mutations", "revoke all on function public.protect_sale_mutations")).toContain("SALE_IMMUTABLE");
    expect(sql).not.toMatch(/create trigger[^;]+on public\.(products|materials|costing_settings)[^;]+sale_items/i);
  });
  it("autorise un coût nul et impose des composantes positives ou nulles", () => {
    expect(sql).toContain("unit_manufacturing_cost_cents >= 0");
    expect(sql).toContain("unit_manufacturing_cost_cents::numeric =");
  });
  it("multiplie le coût par la quantité avec protection bigint", () => {
    expect(sql).toContain("quantity::numeric * unit_manufacturing_cost_cents::numeric");
    expect(sql).toContain("MONETARY_OVERFLOW");
  });
  it("calcule la marge de ligne avant remise globale", () => expect(sql).toContain("quantity::numeric * unit_price_cents::numeric"));
  it("rend la vente complète lorsque toutes les lignes ont un produit", () => expect(sql).toContain("if linked_count = item_count then"));
  it("laisse une vente mixte incomplète tout en figeant ses lignes produit", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation.indexOf("update public.sale_items item set")).toBeLessThan(validation.indexOf("if linked_count = item_count then"));
    expect(validation).toContain("costing_complete = false");
  });
  it("calcule le coût total exact et la marge après remise sans livraison", () => {
    expect(sql).toContain("coalesce(sum(line_manufacturing_cost_cents::numeric), 0)");
    expect(sql).toContain("existing.subtotal_cents::numeric\n      - existing.discount_cents::numeric\n      - total_cost");
    expect(functionSql("validate_sale", "create or replace function public.protect_sale_mutations")).not.toMatch(/margin\s*:=.*shipping_cents/);
  });
  it("autorise une marge négative", () => expect(sql).toContain("manufacturing_margin_cents is not null"));
  it("garantit la cohérence des snapshots et des totaux par contraintes", () => {
    expect(sql).toContain("sale_items_snapshot_consistent");
    expect(sql).toContain("sales_manufacturing_snapshot_consistent");
    expect(sql).toContain("INCONSISTENT_SNAPSHOT_DATA");
  });
  it("laisse les anciennes ventes sans backfill", () => {
    const beforeFunctions = sql.slice(0, sql.indexOf("create function public.calculate_product_costing_internal"));
    expect(beforeFunctions).not.toMatch(/update public\.sales/i);
    expect(beforeFunctions).not.toMatch(/update public\.sale_items/i);
  });
  it("laisse les anciennes ventes et les brouillons non évalués par défaut", () => {
    expect(sql).toContain("add column costing_evaluated boolean not null default false");
    expect(functionSql("create_sale_draft", "create or replace function public.update_sale_draft")).not.toContain("costing_evaluated = true");
  });
  it("marque comme évaluées les ventes complètes, mixtes ou entièrement libres", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation.match(/costing_evaluated = true/g)).toHaveLength(2);
    expect(validation).toMatch(/costing_complete = true,\s+costing_evaluated = true,\s+status = 'validated'/);
    expect(validation).toMatch(/costing_complete = false,\s+costing_evaluated = true,\s+status = 'validated'/);
  });
  it("valide une vente entièrement produit comme évaluée et complète", () => {
    const finalization = functionSql("validate_sale", "create or replace function public.protect_sale_mutations").slice(functionSql("validate_sale", "create or replace function public.protect_sale_mutations").indexOf("if linked_count = item_count then"));
    expect(finalization).toMatch(/if linked_count = item_count then[\s\S]*costing_complete = true,[\s\S]*costing_evaluated = true/);
  });
  it("valide une vente mixte comme évaluée et incomplète", () => {
    const finalization = functionSql("validate_sale", "create or replace function public.protect_sale_mutations").slice(functionSql("validate_sale", "create or replace function public.protect_sale_mutations").indexOf("if linked_count = item_count then"));
    expect(finalization).toMatch(/else[\s\S]*costing_complete = false,[\s\S]*costing_evaluated = true/);
  });
  it("valide une vente entièrement libre comme évaluée et incomplète", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation).toContain("if item_count < 1");
    expect(validation).toContain("if linked_count = item_count then");
    expect(validation).toMatch(/else[\s\S]*costing_complete = false,[\s\S]*costing_evaluated = true/);
  });
  it("interdit une vente complète non évaluée et un brouillon évalué", () => {
    expect(sql).toContain("costing_complete = true\n        and costing_evaluated = true");
    expect(sql).toContain("and (costing_evaluated = false or status <> 'draft')");
  });
  it("valide atomiquement et écrit un audit sans montant détaillé", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation).toContain("for update");
    expect(validation).toContain("insert into public.audit_logs");
    expect(validation).not.toContain("'total_cents'");
  });
  it("interdit toute modification des coûts après validation", () => {
    const protection = functionSql("protect_sale_mutations", "revoke all on function public.protect_sale_mutations");
    expect(protection).toContain("manufacturing_cost_cents is distinct from old.manufacturing_cost_cents");
    expect(protection).toContain("manufacturing_margin_cents is distinct from old.manufacturing_margin_cents");
    expect(protection).toContain("costing_complete is distinct from old.costing_complete");
    expect(protection).toContain("costing_evaluated is distinct from old.costing_evaluated");
  });
  it("ne remplace ni remboursement ni annulation et ne recalcule donc aucun snapshot", () => {
    expect(sql).not.toContain("create or replace function public.record_refund");
    expect(sql).not.toContain("create or replace function public.cancel_sale");
  });
  it("conserve costing_evaluated pendant une annulation contrôlée", () => {
    const protection = functionSql("protect_sale_mutations", "revoke all on function public.protect_sale_mutations");
    expect(protection).toContain("new.costing_evaluated is distinct from old.costing_evaluated");
    expect(sql).not.toContain("create or replace function public.cancel_sale");
  });
  it("audite le marqueur d'évaluation sans montant détaillé", () => {
    const validation = functionSql("validate_sale", "create or replace function public.protect_sale_mutations");
    expect(validation).toContain("'costing_evaluated', true");
    expect(validation).not.toContain("'manufacturing_cost_cents'");
    expect(validation).not.toContain("'manufacturing_margin_cents'");
  });
  it("révoque la fonction interne à public et authenticated", () => {
    expect(sql).toContain("revoke all on function public.calculate_product_costing_internal(uuid, uuid) from public");
    expect(sql).toContain("revoke all on function public.calculate_product_costing_internal(uuid, uuid) from authenticated");
    expect(sql).not.toContain("grant execute on function public.calculate_product_costing_internal");
  });
  it("ne crée aucune politique directe d'écriture", () => expect(sql).not.toMatch(/create policy[\s\S]*for (insert|update|delete)/i));
});

describe("interface et sécurité applicative", () => {
  it("propose Saisie libre et renseigne nom et prix lors de la sélection", () => {
    expect(form).toContain("Produit du catalogue");
    expect(form).toContain("Saisie libre");
    expect(form).toContain("description: product.name");
    expect(form).toContain("moneyInput(product.sale_price_cents)");
  });
  it("explique le moment du snapshot dans le formulaire", () => expect(form).toContain("Le coût de fabrication courant sera figé lors de la validation définitive."));
  it("affiche les coûts historiques sans substituer le coût courant", () => {
    expect(costDisplay).toContain("Coût unitaire historique");
    expect(costDisplay).toContain("Marge de fabrication après remise, avant frais commerciaux, cotisations et fiscalité");
    expect(detail).not.toContain("get_product_costing");
  });
  it("n'infère plus une vente historique depuis la présence de snapshots", () => {
    expect(detail).not.toContain("hasAnySnapshot");
    expect(costDisplay).toContain("getSaleCostingState");
  });
  it("utilise une requête légère paginée sans listProducts", () => {
    expect(queries).toContain('select("id,name,sku,sale_price_cents,is_active")');
    expect(queries).toContain("loadAllSaleProductPages");
    expect(queries).not.toContain("listProducts");
  });
  it("convertit explicitement les nouveaux bigint", () => {
    for (const column of ["manufacturing_cost_cents", "manufacturing_margin_cents", "unit_manufacturing_cost_cents", "line_manufacturing_cost_cents", "line_margin_before_discount_cents"]) expect(queries).toContain(`nullableAmount(${column.startsWith("manufacturing") ? "sale" : "item"}.${column})`);
  });
  it("normalise explicitement les deux booléens de coût", () => {
    expect(queries).toContain("costing_complete: booleanValue(sale.costing_complete)");
    expect(queries).toContain("costing_evaluated: booleanValue(sale.costing_evaluated)");
  });
  it("journalise uniquement les codes d'erreur côté application", () => {
    expect(actions).toContain('console.error("Mutation de vente refusée", { code: error.code })');
    expect(actions).not.toMatch(/console\.error\([^;]*\{[^}]*message\s*:/);
  });
  it("n'expose aucune clé service_role dans le code applicatif ou la migration", () => {
    const application = readFileSync(join(root, "src/lib/supabase/config.ts"), "utf8") + sql;
    expect(application).not.toContain("service_role");
  });
  it("documente formule, lignes libres et absence de reconstitution", () => {
    expect(readme).toContain("sous-total marchandises - remise globale - coût de fabrication historique total");
    expect(readme).toContain("Une ligne libre reste autorisée");
    expect(readme).toContain("aucun coût courant approximatif n’est reconstitué");
  });
});
