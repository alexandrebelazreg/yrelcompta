import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const queries = vi.hoisted(() => ({ listMaterials: vi.fn(), listMaterialCategories: vi.fn(), listProducts: vi.fn(), listSuppliers: vi.fn() }));
vi.mock("@/lib/products/queries", () => ({ listMaterials: queries.listMaterials, listMaterialCategories: queries.listMaterialCategories, listProducts: queries.listProducts }));
vi.mock("@/lib/expenses/queries", () => ({ listSuppliers: queries.listSuppliers }));

const { writeTools } = await import("./write-tools");
const { handleMcpMessage } = await import("./protocol");

const material = (overrides: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-000000000001", business_id: "biz", name: "Chaîne forçat", internal_reference: "CP-001", category_id: "00000000-0000-4000-8000-0000000000c1", material_categories: { name: "Chaîne principale", reference_prefix: "CP" }, supplier_id: null, suppliers: null, color: "Argent", unit: "centimeter", package_quantity_milliunits: 100000, package_cost_cents: 1250, notes: null, is_active: true, ...overrides });

let rpc: ReturnType<typeof vi.fn>;
let similarExpenses: Array<Record<string, unknown>>;
function context() {
  const neq = vi.fn(async () => ({ data: similarExpenses, error: null }));
  const chain = { select: () => chain, eq: () => chain, neq };
  return { supabase: { rpc, from: () => chain }, userId: "user", businessId: "biz", businessName: "Bijoux", clientId: "claude", origin: "https://yrelcompta.example" };
}
async function call(name: string, args: Record<string, unknown>) {
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, writeTools, context() as never) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  return { isError: Boolean(response.result.isError), text: response.result.content[0].text };
}

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: "00000000-0000-4000-8000-0000000000aa", error: null }));
  similarExpenses = [];
  queries.listMaterials.mockResolvedValue([material({}), material({ id: "00000000-0000-4000-8000-000000000003", name: "Chaîne gourmette", internal_reference: "CP-003", color: "Doré" })]);
  queries.listMaterialCategories.mockResolvedValue([{ id: "00000000-0000-4000-8000-0000000000c1", business_id: "biz", name: "Chaîne principale", reference_prefix: "CP" }]);
  queries.listProducts.mockResolvedValue([]);
  queries.listSuppliers.mockResolvedValue([{ id: "00000000-0000-4000-8000-0000000000f1", name: "Perles & Co", is_active: true }]);
});

describe("outils d’écriture du connecteur", () => {
  it("publie la liste complète des outils avec des schémas JSON objets", async () => {
    const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, writeTools, context() as never) as { result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> } };
    expect(response.result.tools.map((tool) => tool.name)).toEqual(writeTools.map((tool) => tool.name));
    for (const tool of response.result.tools) expect(tool.inputSchema, tool.name).toMatchObject({ type: "object", properties: expect.any(Object) });
    const material = response.result.tools.find((tool) => tool.name === "create_material")?.inputSchema as { properties: { package_cost: { anyOf: Array<{ type: string }> } } };
    expect(material.properties.package_cost.anyOf.map((option) => option.type)).toEqual(["string", "number"]);
  });

  it("crée une matière dans une catégorie existante avec la référence suivante et des montants en centimes", async () => {
    const result = await call("create_material", { name: "Chaîne vénitienne", category: "chaîne principale", supplier: "perles & co", color: "Argent", unit: "centimeter", package_quantity: "1,5", package_cost: "12,50" });
    expect(result.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("create_material", expect.objectContaining({ p_business_id: "biz", p_internal_reference: "CP-004", p_category_id: "00000000-0000-4000-8000-0000000000c1", p_new_category_name: null, p_supplier_id: "00000000-0000-4000-8000-0000000000f1", p_new_supplier_name: null, p_package_quantity_milliunits: 1500, p_package_cost_cents: 1250 }));
  });

  it("crée au besoin la catégorie et le fournisseur avec un préfixe proposé", async () => {
    await call("create_material", { name: "Fermoir mousqueton", category: "Fermoirs", supplier: "Atelier Nouveau", unit: "piece", package_quantity: 10, package_cost: 4 });
    expect(rpc).toHaveBeenCalledWith("create_material", expect.objectContaining({ p_category_id: null, p_new_category_name: "Fermoirs", p_new_category_prefix: "FER", p_internal_reference: "FER-001", p_supplier_id: null, p_new_supplier_name: "Atelier Nouveau", p_package_cost_cents: 400 }));
  });

  it("refuse un doublon de matière sans appeler la base", async () => {
    const result = await call("create_material", { name: "chaîne forçat", color: "argent", unit: "centimeter", package_quantity: "1", package_cost: "1" });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("update_material");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ne modifie que les champs fournis d’une matière", async () => {
    await call("update_material", { material: "CP-003", package_cost: "15" });
    expect(rpc).toHaveBeenCalledWith("update_material", expect.objectContaining({ p_material_id: "00000000-0000-4000-8000-000000000003", p_name: "Chaîne gourmette", p_internal_reference: "CP-003", p_category_id: "00000000-0000-4000-8000-0000000000c1", p_color: "Doré", p_unit: "centimeter", p_package_quantity_milliunits: 100000, p_package_cost_cents: 1500, p_is_active: true }));
  });

  it("crée un produit en résolvant la recette par référence ou par nom", async () => {
    const result = await call("create_product", { name: "Collier Lune", sale_price: "45", category: "Collier", recipe: [{ material: "CP-001", quantity: "42" }, { material: "Chaîne gourmette", quantity: 2 }] });
    expect(result.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("save_product_with_recipe", expect.objectContaining({ p_product_id: null, p_sale_price_cents: 4500, p_category: "Collier", p_lines: [{ material_id: "00000000-0000-4000-8000-000000000001", quantity_milliunits: 42000, position: 1 }, { material_id: "00000000-0000-4000-8000-000000000003", quantity_milliunits: 2000, position: 2 }] }));
  });

  it("signale une matière inconnue dans une recette", async () => {
    const result = await call("create_product", { name: "Bague", sale_price: "20", recipe: [{ material: "Inconnue", quantity: "1" }] });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("crée une dépense en brouillon et renvoie le lien de validation", async () => {
    const result = await call("create_expense_draft", { description: "Commande perles", purchased_on: "2026-11-10", total_amount: "38,90", category: "raw_materials", supplier: "Perles & Co" });
    expect(rpc).toHaveBeenCalledWith("create_expense_draft", expect.objectContaining({ p_purchased_on: "2026-11-10", p_total_amount_cents: 3890, p_professional_share_basis_points: 10000, p_supplier_id: "00000000-0000-4000-8000-0000000000f1", p_nature: "operating", p_cost_behavior: "variable" }));
    expect(JSON.parse(result.text)).toMatchObject({ statut: "brouillon", a_valider_ici: "https://yrelcompta.example/depenses/00000000-0000-4000-8000-0000000000aa" });
  });

  it("bloque une dépense identique sauf confirmation explicite", async () => {
    similarExpenses = [{ id: "dep-1", description: "Commande perles", status: "draft" }];
    const blocked = await call("create_expense_draft", { description: "commande perles", purchased_on: "2026-11-10", total_amount: "38,90", category: "raw_materials" });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("/depenses/dep-1");
    expect(rpc).not.toHaveBeenCalled();
    await call("create_expense_draft", { description: "commande perles", purchased_on: "2026-11-10", total_amount: "38,90", category: "raw_materials", allow_duplicate: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("exige un fournisseur existant pour une charge récurrente", async () => {
    const result = await call("create_recurring_charge", { description: "Shopify", estimated_amount: "36", frequency: "monthly", category: "software", supplier: "Shopify" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("create_supplier");
  });

  it("crée une charge fixe de fonctionnement par défaut", async () => {
    await call("create_recurring_charge", { description: "Canva", estimated_amount: 12, frequency: "monthly", next_due_on: "2026-12-01", category: "software" });
    expect(rpc).toHaveBeenCalledWith("create_recurring_expense_template", expect.objectContaining({ p_estimated_amount_cents: 1200, p_nature: "operating", p_cost_behavior: "fixed", p_next_due_on: "2026-12-01", p_auto_generate: true }));
  });

  it("ne recrée pas un fournisseur existant", async () => {
    const result = await call("create_supplier", { name: "PERLES & CO" });
    expect(JSON.parse(result.text)).toMatchObject({ cree: false, id: "00000000-0000-4000-8000-0000000000f1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("traduit un refus de la base en message clair", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    const result = await call("create_supplier", { name: "Nouveau" });
    expect(result).toEqual({ isError: true, text: "Cet élément existe déjà : un nom, une référence, un SKU ou un préfixe identique est déjà utilisé." });
  });
});
