import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ listMaterials: vi.fn(), listMaterialPurchases: vi.fn(), listSuppliers: vi.fn(), listExpenses: vi.fn(), getExpense: vi.fn() }));
vi.mock("@/lib/products/queries", () => ({ listMaterials: mocks.listMaterials }));
vi.mock("@/lib/products/purchase-queries", () => ({ listMaterialPurchases: mocks.listMaterialPurchases }));
vi.mock("@/lib/expenses/queries", () => ({ listSuppliers: mocks.listSuppliers, listExpenses: mocks.listExpenses, getExpense: mocks.getExpense }));
vi.mock("./safe-fetch", () => ({ fetchPublicFile: vi.fn() }));

const { materialPurchaseTools } = await import("./material-purchase-tools");
const { handleMcpMessage } = await import("./protocol");

const BIZ = "11111111-1111-4111-8111-111111111111";
const MAT = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const SUP = "55555555-5555-4555-8555-555555555555";
const EXP = "66666666-6666-4666-8666-666666666666";
const material = { id: MAT, name: "Perle nacre", internal_reference: "PE-001", unit: "piece", is_active: true };
const purchase = (id: string, overrides: Record<string, unknown> = {}) => ({ id, material_id: MAT, purchased_on: "2026-10-01", supplier_id: null, suppliers: null, order_reference: null, quantity_milliunits: 10_000, total_cost_cents: 100, expense_id: null, expenses: null, excluded: false, source: "purchase", created_at: "2026-10-01T10:00:00Z", ...overrides });

let rpc: ReturnType<typeof vi.fn>;
async function call(name: string, args: Record<string, unknown>) {
  const context = { supabase: { rpc }, userId: "u", businessId: BIZ, businessName: "B", clientId: "c", origin: "https://x.example" };
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, materialPurchaseTools, context as never) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  return { isError: Boolean(response.result.isError), text: response.result.content[0].text };
}

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: P2, error: null }));
  mocks.listMaterials.mockResolvedValue([material]);
  mocks.listMaterialPurchases.mockResolvedValue([purchase(P1, { source: "sheet" }), purchase(P2, { quantity_milliunits: 1_000, total_cost_cents: 50, suppliers: { name: "Perles & Co" }, order_reference: "CMD-9" })]);
  mocks.listSuppliers.mockResolvedValue([{ id: SUP, name: "Perles & Co", is_active: true }]);
  mocks.listExpenses.mockResolvedValue([{ id: EXP, reference: "DEP-2026-0042" }]);
  mocks.getExpense.mockResolvedValue({ id: EXP, reference: "DEP-2026-0042", status: "validated" });
});

describe("historique d’achats (connecteur)", () => {
  it("liste les achats avec l’achat retenu et la reprise de la fiche", async () => {
    const rows = JSON.parse((await call("list_material_purchases", { material: "PE-001" })).text);
    expect(mocks.listMaterialPurchases).toHaveBeenCalledWith(BIZ, MAT);
    expect(rows).toEqual([
      expect.objectContaining({ id: P1, origine: "Reprise de la fiche", retenu: false, quantite: "10 pièce" }),
      expect.objectContaining({ id: P2, origine: "Achat", retenu: true, fournisseur: "Perles & Co", numero_commande: "CMD-9", cout_unitaire: "0,50 €" }),
    ]);
  });

  it("ajoute un achat en centimes et millièmes, avec fournisseur existant et dépense liée", async () => {
    const result = await call("add_material_purchase", { material: "Perle nacre", purchased_on: "2026-11-02", quantity: "25", total_cost: "7,40", supplier: "perles & co", order_reference: "CMD-10", expense: "dep-2026-0042" });
    expect(result.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("add_material_purchase", { p_business_id: BIZ, p_material_id: MAT, p_purchased_on: "2026-11-02", p_supplier_id: SUP, p_new_supplier_name: null, p_order_reference: "CMD-10", p_quantity_milliunits: 25_000, p_total_cost_cents: 740, p_expense_id: EXP, p_excluded: false });
    expect(JSON.parse(result.text)).toMatchObject({ ajoute: true, cout_unitaire_retenu: "0,50 € / pièce" });
  });

  it("crée le fournisseur à la volée s’il n’existe pas", async () => {
    await call("add_material_purchase", { material: "PE-001", purchased_on: "2026-11-02", quantity: 1, total_cost: 2, supplier: "Atelier Neuf" });
    expect(rpc).toHaveBeenCalledWith("add_material_purchase", expect.objectContaining({ p_supplier_id: null, p_new_supplier_name: "Atelier Neuf" }));
  });

  it("modifie seulement les champs fournis (exclusion du calcul)", async () => {
    await call("update_material_purchase", { purchase: P2, excluded: true });
    expect(rpc).toHaveBeenCalledWith("update_material_purchase", { p_purchase_id: P2, p_business_id: BIZ, p_purchased_on: "2026-10-01", p_supplier_id: null, p_new_supplier_name: null, p_order_reference: "CMD-9", p_quantity_milliunits: 1_000, p_total_cost_cents: 50, p_expense_id: null, p_excluded: true });
  });

  it("exige la confirmation pour supprimer un achat", async () => {
    expect((await call("delete_material_purchase", { purchase: P1 })).isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect((await call("delete_material_purchase", { purchase: P1, confirmation: true })).isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("delete_material_purchase", { p_purchase_id: P1, p_business_id: BIZ });
  });

  it("explique le refus de retirer le dernier achat compté", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "at least one counted purchase required" } });
    const result = await call("delete_material_purchase", { purchase: P2, confirmation: true });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("au moins un achat compté");
  });

  it("refuse une dépense annulée", async () => {
    mocks.getExpense.mockResolvedValue({ id: EXP, reference: "DEP-2026-0042", status: "cancelled" });
    const result = await call("add_material_purchase", { material: "PE-001", purchased_on: "2026-11-02", quantity: 1, total_cost: 2, expense: EXP });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
