import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ listSales: vi.fn(), getSale: vi.fn(), listProducts: vi.fn(), listBillingDocuments: vi.fn(), getBillingDocument: vi.fn(), getInvoiceForSale: vi.fn() }));
vi.mock("@/lib/sales/queries", () => ({ listSales: mocks.listSales, getSale: mocks.getSale }));
vi.mock("@/lib/products/queries", () => ({ listProducts: mocks.listProducts }));
vi.mock("@/lib/invoicing/queries", () => ({ listBillingDocuments: mocks.listBillingDocuments, getBillingDocument: mocks.getBillingDocument, getInvoiceForSale: mocks.getInvoiceForSale }));

const { salesReadTools, salesWriteTools } = await import("./sales-tools");
const { handleMcpMessage } = await import("./protocol");

const sale = (overrides: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-0000000000a1", business_id: "biz", reference: "V-2026-0001", ordered_on: "2026-11-05", channel: "market", customer_name: "Camille", notes: null, status: "validated", subtotal_cents: 4500, shipping_cents: 0, discount_cents: 0, total_cents: 4500, manufacturing_cost_cents: 1500, manufacturing_margin_cents: 3000, costing_complete: true, costing_evaluated: true, validated_at: null, cancelled_at: null, cancellation_reason: null, sale_items: [], payments: [{ id: "p", received_on: "2026-11-05", bank_deposited_on: null, gross_amount_cents: 4500, platform_fee_cents: 0, net_deposit_cents: 4500, method: "cash", external_reference: null, notes: null, refunds: [] }], ...overrides });
const invoice = { id: "00000000-0000-4000-8000-0000000000b1", kind: "invoice", number: "F-2026-0007", issuedOn: "2026-11-06", supplyOn: "2026-11-05", saleReference: "V-2026-0001", buyerName: "Camille Martin", buyerKind: "individual", buyerEmail: "camille@example.com", buyerAddress: "1 rue Secrète", totalExclTaxCents: 4500, vatCents: 0, totalInclTaxCents: 4500, subtotalExclTaxCents: 4500, shippingExclTaxCents: 0, discountExclTaxCents: 0, paymentDueOn: "2026-11-06", commercialState: "invoice", originalInvoiceNumber: null, creditReason: null, vatExemptionMentionSnapshot: "TVA non applicable, art. 293 B du CGI", items: [{ id: "l", description: "Collier Lune", quantity: 1, unitPriceExclTaxCents: 4500, lineTotalExclTaxCents: 4500, position: 1 }], credits: [] };

let rpc: ReturnType<typeof vi.fn>;
async function call(name: string, args: Record<string, unknown>) {
  const context = { supabase: { rpc }, userId: "user", businessId: "biz", businessName: "Bijoux", clientId: "claude", origin: "https://yrelcompta.example" };
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, [...salesReadTools, ...salesWriteTools], context as never) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  return { isError: Boolean(response.result.isError), text: response.result.content[0].text };
}

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: "00000000-0000-4000-8000-0000000000c1", error: null }));
  mocks.listSales.mockResolvedValue([sale({}), sale({ id: "00000000-0000-4000-8000-0000000000a2", reference: "V-2026-0002", ordered_on: "2026-10-20" })]);
  mocks.getSale.mockResolvedValue(sale({}));
  mocks.getInvoiceForSale.mockResolvedValue(invoice);
  mocks.listBillingDocuments.mockResolvedValue([invoice]);
  mocks.getBillingDocument.mockResolvedValue({ document: invoice, refunds: [] });
  mocks.listProducts.mockResolvedValue([{ id: "00000000-0000-4000-8000-0000000000d1", name: "Collier Lune", sku: "COL-LUNE", sale_price_cents: 4500 }]);
});

describe("ventes et factures dans le connecteur", () => {
  it("filtre les ventes par période et résume encaissement et marge", async () => {
    const result = JSON.parse((await call("list_sales", { from: "2026-11-01", to: "2026-11-30" })).text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reference: "V-2026-0001", statut: "Validée" });
    expect(result[0].reste_a_encaisser).toMatch(/^0,00\s€$/);
    expect(result[0].total).toMatch(/^45,00\s€$/);
    expect(result[0].marge_de_fabrication).toMatch(/^30,00\s€$/);
  });

  it("retrouve une vente par sa référence avec sa facture", async () => {
    const result = JSON.parse((await call("get_sale", { sale: "v-2026-0001" })).text);
    expect(mocks.getSale).toHaveBeenCalledWith("biz", "00000000-0000-4000-8000-0000000000a1");
    expect(result.facture).toEqual({ numero: "F-2026-0007", emise_le: "2026-11-06", etat: "Facture" });
  });

  it("détaille une facture par son numéro sans les coordonnées de l’acheteur", async () => {
    const { text } = await call("get_invoice", { invoice: "F-2026-0007" });
    expect(JSON.parse(text)).toMatchObject({ numero: "F-2026-0007", acheteur: "Camille Martin", lignes: [{ description: "Collier Lune" }] });
    expect(text).not.toContain("camille@example.com");
    expect(text).not.toContain("rue Secrète");
  });

  it("crée un brouillon de vente en reprenant le prix du produit du catalogue", async () => {
    const result = await call("create_sale_draft", { ordered_on: "2026-11-12", channel: "market", customer_name: "Inès", items: [{ product: "col-lune", quantity: 2 }, { description: "Bracelet sur mesure", unit_price: "30" }], shipping: "4,90", discount: 5 });
    expect(result.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("create_sale_draft", { p_business_id: "biz", p_ordered_on: "2026-11-12", p_channel: "market", p_customer_name: "Inès", p_notes: null, p_shipping_cents: 490, p_discount_cents: 500, p_items: [{ description: "Collier Lune", quantity: 2, unit_price_cents: 4500, product_id: "00000000-0000-4000-8000-0000000000d1" }, { description: "Bracelet sur mesure", quantity: 1, unit_price_cents: 3000, product_id: null }] });
    expect(JSON.parse(result.text)).toMatchObject({ statut: "brouillon", a_valider_ici: "https://yrelcompta.example/ventes/00000000-0000-4000-8000-0000000000c1" });
  });

  it("refuse un produit inconnu ou une ligne sans prix", async () => {
    expect((await call("create_sale_draft", { channel: "direct", items: [{ product: "Inconnu" }] })).isError).toBe(true);
    expect((await call("create_sale_draft", { channel: "direct", items: [{ description: "Sans prix" }] })).isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuse une remise supérieure au total", async () => {
    const result = await call("create_sale_draft", { channel: "direct", items: [{ description: "Bague", unit_price: "10" }], discount: "50" });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
