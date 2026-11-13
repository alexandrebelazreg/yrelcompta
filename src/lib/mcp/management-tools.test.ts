import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  listSales: vi.fn(), getSale: vi.fn(),
  listProducts: vi.fn(), getProduct: vi.fn(), listMaterials: vi.fn(), listMaterialCategories: vi.fn(), getCostingSettings: vi.fn(),
  listExpenses: vi.fn(), getExpense: vi.fn(), listRecurringTemplates: vi.fn(), listSuppliers: vi.fn(),
  listBillingDocuments: vi.fn(), getBillingDocument: vi.fn(), getInvoiceForSale: vi.fn(),
}));
vi.mock("@/lib/sales/queries", () => ({ listSales: m.listSales, getSale: m.getSale }));
vi.mock("@/lib/products/queries", () => ({ listProducts: m.listProducts, getProduct: m.getProduct, listMaterials: m.listMaterials, listMaterialCategories: m.listMaterialCategories, getCostingSettings: m.getCostingSettings }));
vi.mock("@/lib/expenses/queries", () => ({ listExpenses: m.listExpenses, getExpense: m.getExpense, listRecurringTemplates: m.listRecurringTemplates, listSuppliers: m.listSuppliers }));
vi.mock("@/lib/invoicing/queries", () => ({ listBillingDocuments: m.listBillingDocuments, getBillingDocument: m.getBillingDocument, getInvoiceForSale: m.getInvoiceForSale }));

const { managementTools } = await import("./management-tools");
const { handleMcpMessage } = await import("./protocol");

const SALE = "00000000-0000-4000-8000-0000000000a1";
const PAYMENT = "00000000-0000-4000-8000-0000000000b1";
const EXPENSE = "00000000-0000-4000-8000-0000000000e1";
const EXPENSE_PAYMENT = "00000000-0000-4000-8000-0000000000e2";

const sale = (overrides: Record<string, unknown> = {}) => ({ id: SALE, business_id: "biz", reference: "V-2026-0001", ordered_on: "2026-11-05", channel: "market", customer_name: "Camille Martin", notes: null, status: "draft", subtotal_cents: 4500, shipping_cents: 0, discount_cents: 0, total_cents: 4500, manufacturing_cost_cents: null, manufacturing_margin_cents: null, costing_complete: false, costing_evaluated: false, validated_at: null, cancelled_at: null, cancellation_reason: null, sale_items: [{ description: "Collier Lune", quantity: 1, unit_price_cents: 4500, line_total_cents: 4500, product_id: null, position: 1 }], payments: [], ...overrides });
const expense = (overrides: Record<string, unknown> = {}) => ({ id: EXPENSE, business_id: "biz", reference: "D-2026-0003", purchased_on: "2026-11-10", due_on: null, supplier_id: null, category: "raw_materials", subcategory: null, nature: "operating", cost_behavior: "variable", description: "Commande perles", external_reference: null, total_amount_cents: 3890, professional_share_basis_points: 10000, business_amount_cents: 3890, notes: null, status: "draft", validated_at: null, recurring_template_id: null, recurring_due_on: null, cancelled_at: null, cancellation_reason: null, suppliers: null, expense_payments: [], expense_documents: [], ...overrides });

let rpc: ReturnType<typeof vi.fn>;
async function call(name: string, args: Record<string, unknown>) {
  const context = { supabase: { rpc }, userId: "user", businessId: "biz", businessName: "Bijoux", clientId: "claude", origin: "https://yrelcompta.example" };
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, managementTools, context as never) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  return { isError: Boolean(response.result.isError), text: response.result.content[0].text };
}

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: "00000000-0000-4000-8000-0000000000f9", error: null }));
  m.listSales.mockResolvedValue([sale()]);
  m.getSale.mockResolvedValue(sale());
  m.getExpense.mockResolvedValue(expense());
  m.listExpenses.mockResolvedValue([expense()]);
  m.listSuppliers.mockResolvedValue([]);
  m.getBillingDocument.mockResolvedValue({ document: { number: "F-2026-0008", totalInclTaxCents: 4500 }, refunds: [] });
});

describe("outils de gestion complète du connecteur", () => {
  it("publie tous les outils du serveur, et exige une confirmation pour chaque action définitive", async () => {
    const [{ readOnlyTools }, { writeTools }, { salesReadTools, salesWriteTools }] = await Promise.all([import("./tools"), import("./write-tools"), import("./sales-tools")]);
    const all = [...readOnlyTools, ...salesReadTools, ...writeTools, ...salesWriteTools, ...managementTools];
    const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, all as never, {} as never) as { result: { tools: Array<{ name: string; inputSchema: { type: string; required?: string[]; properties: Record<string, { const?: unknown }> }; annotations: { destructiveHint: boolean; readOnlyHint: boolean } }> } };
    const tools = response.result.tools;
    expect(tools).toHaveLength(all.length);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    const destructive = tools.filter((tool) => tool.annotations.destructiveHint);
    expect(destructive.map((tool) => tool.name).sort()).toEqual(["archive_material", "archive_product", "archive_recurring_charge", "archive_supplier", "cancel_expense", "cancel_sale", "delete_expense_draft", "delete_sale_draft", "issue_credit_note", "issue_invoice", "record_expense_payment", "record_expense_refund", "record_sale_payment", "record_sale_refund", "validate_expense", "validate_sale"]);
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      if (tool.annotations.destructiveHint) {
        expect(tool.inputSchema.required, tool.name).toContain("confirmation");
        expect(tool.inputSchema.properties.confirmation.const, tool.name).toBe(true);
        expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
      }
    }
  });

  it("refuse une action définitive sans confirmation explicite, sans appeler la base", async () => {
    const result = await call("validate_sale", { sale: "V-2026-0001" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("confirmation");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("valide une vente confirmée", async () => {
    const result = await call("validate_sale", { sale: "v-2026-0001", confirmation: true });
    expect(result.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("validate_sale", { p_sale_id: SALE, p_business_id: "biz" });
  });

  it("modifie un brouillon de vente en conservant les lignes non fournies", async () => {
    await call("update_sale_draft", { sale: SALE, shipping: "4,90" });
    expect(rpc).toHaveBeenCalledWith("update_sale_draft", expect.objectContaining({ p_sale_id: SALE, p_shipping_cents: 490, p_channel: "market", p_customer_name: "Camille Martin", p_items: [{ description: "Collier Lune", quantity: 1, unit_price_cents: 4500, product_id: null }] }));
  });

  it("refuse de modifier une vente validée", async () => {
    m.getSale.mockResolvedValue(sale({ status: "validated" }));
    const result = await call("update_sale_draft", { sale: SALE, notes: "x" });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rembourse l’unique encaissement d’une vente sans demander son identifiant", async () => {
    m.getSale.mockResolvedValue(sale({ status: "validated", payments: [{ id: PAYMENT, received_on: "2026-11-05", gross_amount_cents: 4500, platform_fee_cents: 0, net_deposit_cents: 4500, method: "cash", refunds: [] }] }));
    await call("record_sale_refund", { sale: SALE, amount: "10", reason: "Fermoir abîmé", refunded_on: "2026-11-12", confirmation: true });
    expect(rpc).toHaveBeenCalledWith("record_refund", { p_payment_id: PAYMENT, p_sale_id: SALE, p_business_id: "biz", p_refunded_on: "2026-11-12", p_amount_cents: 1000, p_kind: "customer_refund", p_reason: "Fermoir abîmé" });
  });

  it("émet une facture avec l’acheteur et la date de la vente par défaut", async () => {
    m.getSale.mockResolvedValue(sale({ status: "validated" }));
    const result = await call("issue_invoice", { sale: SALE, payment_due_on: "2026-11-20", confirmation: true });
    expect(rpc).toHaveBeenCalledWith("issue_invoice", expect.objectContaining({ p_sale_id: SALE, p_buyer_name: "Camille Martin", p_buyer_kind: "individual", p_supply_on: "2026-11-05", p_payment_due_on: "2026-11-20", p_operation_category: "goods" }));
    expect(JSON.parse(result.text)).toMatchObject({ emise: true, numero: "F-2026-0008" });
  });

  it("exige le SIREN d’un acheteur professionnel", async () => {
    m.getSale.mockResolvedValue(sale({ status: "validated" }));
    const result = await call("issue_invoice", { sale: SALE, buyer_kind: "professional", confirmation: true });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("modifie un brouillon de dépense en ne changeant que le montant", async () => {
    await call("update_expense_draft", { expense: "D-2026-0003", total_amount: "41,20" });
    expect(rpc).toHaveBeenCalledWith("update_expense_draft", expect.objectContaining({ p_expense_id: EXPENSE, p_total_amount_cents: 4120, p_description: "Commande perles", p_purchased_on: "2026-11-10", p_category: "raw_materials", p_professional_share_basis_points: 10000 }));
  });

  it("rembourse un paiement fournisseur en reprenant sa date de paiement", async () => {
    m.getExpense.mockResolvedValue(expense({ status: "validated", expense_payments: [{ id: EXPENSE_PAYMENT, paid_on: "2026-11-10", amount_cents: 3890, business_amount_cents: 3890, method: "card", expense_refunds: [] }] }));
    await call("record_expense_refund", { expense: EXPENSE, amount: "5", reason: "Perles manquantes", received_on: "2026-11-12", confirmation: true });
    expect(rpc).toHaveBeenCalledWith("record_expense_refund", expect.objectContaining({ p_expense_payment_id: EXPENSE_PAYMENT, p_amount_cents: 500, p_kind: "supplier_refund", p_received_on: "2026-11-12" }));
  });

  it("explique clairement un refus métier de la base", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getSale.mockResolvedValue(sale({ status: "validated" }));
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "cannot cancel sale with non-zero net payment" } });
    const result = await call("cancel_sale", { sale: SALE, reason: "Commande annulée", confirmation: true });
    expect(result).toEqual({ isError: true, text: "L’annulation est impossible tant que le montant net encaissé ou payé n’est pas nul : enregistrez d’abord un remboursement." });
  });

  it("conserve la recette d’un produit quand elle n’est pas fournie", async () => {
    const product = { id: "00000000-0000-4000-8000-0000000000c1", name: "Collier Lune", sku: "COL-LUNE", category: "Collier", sale_price_cents: 4500, labor_minutes: 30, packaging_cost_cents: null, material_loss_basis_points: 500, notes: null, is_active: true, product_materials: [{ material_id: "00000000-0000-4000-8000-0000000000d1", quantity_milliunits: 42000 }] };
    m.listProducts.mockResolvedValue([product]);
    m.getProduct.mockResolvedValue(product);
    await call("update_product", { product: "COL-LUNE", sale_price: "49" });
    expect(rpc).toHaveBeenCalledWith("save_product_with_recipe", expect.objectContaining({ p_product_id: product.id, p_sale_price_cents: 4900, p_labor_minutes: 30, p_material_loss_basis_points: 500, p_lines: [{ material_id: "00000000-0000-4000-8000-0000000000d1", quantity_milliunits: 42000, position: 1 }] }));
  });
});
