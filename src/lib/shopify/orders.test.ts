import { describe, expect, it } from "vitest";
import { customerNameFrom, normalizeShopifyOrder, parisDate, shopifyGatewayToMethod, shopifyHistoryQuery, shopifyMoneyToCents, type ShopifyOrderNode } from "./orders";

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "EUR" } });

const order = (overrides: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode => ({
  id: "gid://shopify/Order/1001",
  name: "#1001",
  test: false,
  processedAt: "2026-11-12T23:30:00Z",
  cancelledAt: null,
  currencyCode: "EUR",
  displayFinancialStatus: "PAID",
  taxesIncluded: false,
  totalPriceSet: money("94.90"),
  totalShippingPriceSet: money("4.90"),
  totalDiscountsSet: money("5.00"),
  totalTaxSet: null,
  totalReceivedSet: money("94.90"),
  totalRefundedSet: money("0.00"),
  lineItems: { nodes: [
    { title: "Collier Lune", variantTitle: "Doré", quantity: 2, sku: "COL-LUNE", originalUnitPriceSet: money("45.00"), product: { id: "gid://shopify/Product/1" }, variant: { id: "gid://shopify/ProductVariant/11", sku: "COL-LUNE-OR" } },
    { title: "Carte cadeau", variantTitle: "Default Title", quantity: 0, sku: null, originalUnitPriceSet: money("10.00"), product: null, variant: null },
  ] },
  transactions: [
    { kind: "AUTHORIZATION", status: "SUCCESS", gateway: "shopify_payments", processedAt: "2026-11-12T23:29:00Z", fees: [{ amount: { amount: "9.99" } }] },
    { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", processedAt: "2026-11-12T23:31:00Z", fees: [{ amount: { amount: "1.79" } }, { amount: { amount: "0.25" } }] },
    { kind: "SALE", status: "FAILURE", gateway: "paypal", processedAt: "2026-11-12T23:28:00Z", fees: [{ amount: { amount: "3.00" } }] },
  ],
  ...overrides,
});

describe("commandes Shopify", () => {
  it("convertit les montants décimaux en centimes sans calcul flottant", () => {
    expect(shopifyMoneyToCents("12.5")).toBe(1250);
    expect(shopifyMoneyToCents("12.345")).toBe(1235);
    expect(shopifyMoneyToCents("0.1")).toBe(10);
    expect(shopifyMoneyToCents(null)).toBe(0);
    expect(() => shopifyMoneyToCents("12,50")).toThrow();
  });

  it("date les commandes à l’heure de Paris", () => {
    expect(parisDate("2026-11-12T23:30:00Z")).toBe("2026-11-13");
    expect(parisDate("2026-07-01T21:59:00Z")).toBe("2026-07-01");
  });

  it("déduit le moyen d’encaissement de la passerelle", () => {
    expect(shopifyGatewayToMethod("shopify_payments")).toBe("card");
    expect(shopifyGatewayToMethod("PayPal Express Checkout")).toBe("paypal");
    expect(shopifyGatewayToMethod("Bank Deposit")).toBe("bank_transfer");
    expect(shopifyGatewayToMethod(null)).toBe("other");
  });

  it("normalise une commande payée : lignes, port, remise et frais Shopify Payments", () => {
    expect(normalizeShopifyOrder(order())).toEqual({
      gid: "gid://shopify/Order/1001",
      name: "#1001",
      test: false,
      cancelled: false,
      financial_status: "PAID",
      currency: "EUR",
      ordered_on: "2026-11-13",
      payment_on: "2026-11-13",
      payment_method: "card",
      shipping_cents: 490,
      discount_cents: 500,
      tax_cents: 0,
      total_cents: 9490,
      received_cents: 9490,
      refunded_cents: 0,
      fee_cents: 204,
      lines: [{ title: "Collier Lune — Doré", quantity: 2, unit_price_cents: 4500, sku: "COL-LUNE-OR", product_gid: "gid://shopify/Product/1", variant_gid: "gid://shopify/ProductVariant/11" }],
    });
  });

  it("signale une commande annulée et ne transmet aucune donnée cliente", () => {
    const normalized = normalizeShopifyOrder(order({ cancelledAt: "2026-11-14T10:00:00Z" }));
    expect(normalized.cancelled).toBe(true);
    expect(JSON.stringify(normalized)).not.toMatch(/email|address|phone|customer/i);
  });

  it("lit le nom de la cliente s’il n’est pas masqué par Shopify", () => {
    expect(customerNameFrom({ order: { billingAddress: { firstName: " Camille ", lastName: "Martin" } } })).toBe("Camille Martin");
    expect(customerNameFrom({ order: { billingAddress: null } })).toBeNull();
    expect(customerNameFrom(null)).toBeNull();
  });

  it("construit la recherche des commandes payées depuis une date", () => {
    expect(shopifyHistoryQuery("2026-09-01")).toBe("created_at:>='2026-09-01' (financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded)");
    expect(() => shopifyHistoryQuery("01/09/2026")).toThrow();
  });
});
