/** Lecture et normalisation des commandes Shopify (module pur, sans accès réseau). */

export const SHOPIFY_ORDER_FIELDS = `
  id
  name
  test
  processedAt
  updatedAt
  cancelledAt
  currencyCode
  displayFinancialStatus
  taxesIncluded
  totalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount } }
  totalDiscountsSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalReceivedSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  lineItems(first: 200) {
    nodes {
      title
      variantTitle
      quantity
      sku
      originalUnitPriceSet { shopMoney { amount } }
      product { id }
      variant { id sku }
    }
  }
  transactions(first: 50) {
    kind
    status
    gateway
    processedAt
    fees { amount { amount } }
  }
`;

export const SHOPIFY_ORDER_QUERY = `#graphql
  query YrelComptaOrder($id: ID!) {
    order(id: $id) { ${SHOPIFY_ORDER_FIELDS} }
  }
`;

export const SHOPIFY_ORDERS_QUERY = `#graphql
  query YrelComptaOrders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query, sortKey: PROCESSED_AT) {
      nodes { ${SHOPIFY_ORDER_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Commandes créées ou modifiées depuis la dernière synchronisation, de la plus ancienne à la plus récente. */
export const SHOPIFY_RECENT_ORDERS_QUERY = `#graphql
  query YrelComptaRecentOrders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes { ${SHOPIFY_ORDER_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Nom de la cliente, demandé à part : Shopify peut le masquer (données clientes protégées). */
export const SHOPIFY_ORDER_CUSTOMER_QUERY = `#graphql
  query YrelComptaOrderCustomer($id: ID!) {
    order(id: $id) { billingAddress { firstName lastName } }
  }
`;

type Money = { shopMoney?: { amount?: string | number | null; currencyCode?: string } | null } | null | undefined;

export interface ShopifyOrderNode {
  id: string;
  name: string;
  test: boolean;
  processedAt: string;
  updatedAt?: string;
  cancelledAt: string | null;
  currencyCode: string;
  displayFinancialStatus: string | null;
  taxesIncluded: boolean;
  totalPriceSet: Money;
  totalShippingPriceSet: Money;
  totalDiscountsSet: Money;
  totalTaxSet: Money;
  totalReceivedSet: Money;
  totalRefundedSet: Money;
  lineItems: { nodes: Array<{ title: string; variantTitle: string | null; quantity: number; sku: string | null; originalUnitPriceSet: Money; product: { id: string } | null; variant: { id: string; sku: string | null } | null }> };
  transactions: Array<{ kind: string; status: string; gateway: string | null; processedAt: string | null; fees?: Array<{ amount?: { amount?: string | number | null } | null }> | null }>;
}

export type SalePaymentMethod = "cash" | "card" | "bank_transfer" | "paypal" | "stripe" | "sumup" | "etsy" | "cheque" | "other";

/** Commande normalisée transmise à la base : montants en centimes, sans aucune donnée cliente. */
export interface NormalizedShopifyOrder {
  gid: string;
  name: string;
  test: boolean;
  cancelled: boolean;
  financial_status: string;
  currency: string;
  ordered_on: string;
  payment_on: string;
  payment_method: SalePaymentMethod;
  shipping_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  received_cents: number;
  refunded_cents: number;
  fee_cents: number;
  lines: Array<{ title: string; quantity: number; unit_price_cents: number; sku: string | null; product_gid: string | null; variant_gid: string | null }>;
}

/** Convertit un montant décimal Shopify (« 12.5 », « 12.50 ») en centimes, sans calcul flottant. */
export function shopifyMoneyToCents(value: string | number | null | undefined): number {
  const text = String(value ?? "0").trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error("SHOPIFY_AMOUNT_INVALID");
  const [, sign, whole, decimals = ""] = match;
  const padded = `${decimals}000`;
  let cents = BigInt(whole) * BigInt(100) + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += BigInt(1); // arrondi au centime le plus proche
  const result = Number(sign ? -cents : cents);
  if (!Number.isSafeInteger(result)) throw new Error("SHOPIFY_AMOUNT_INVALID");
  return result;
}

const money = (value: Money) => Math.max(0, shopifyMoneyToCents(value?.shopMoney?.amount));

/** Date du jour à Paris (AAAA-MM-JJ) d'un horodatage Shopify. */
export function parisDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error("SHOPIFY_DATE_INVALID");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Moyen d'encaissement YrelCompta correspondant à la passerelle de paiement Shopify. */
export function shopifyGatewayToMethod(gateway: string | null | undefined): SalePaymentMethod {
  const value = (gateway ?? "").toLowerCase();
  if (value.includes("paypal")) return "paypal";
  if (value.includes("stripe")) return "stripe";
  if (value.includes("sumup")) return "sumup";
  if (value.includes("shopify_payments") || value.includes("card") || value.includes("apple") || value.includes("google")) return "card";
  if (value.includes("bank") || value.includes("virement") || value.includes("transfer")) return "bank_transfer";
  if (value.includes("cash") || value.includes("espèces") || value.includes("especes")) return "cash";
  return "other";
}

export function normalizeShopifyOrder(order: ShopifyOrderNode): NormalizedShopifyOrder {
  const paid = order.transactions.filter((transaction) => transaction.status === "SUCCESS" && (transaction.kind === "SALE" || transaction.kind === "CAPTURE"));
  const firstPayment = paid.find((transaction) => transaction.processedAt) ?? null;
  const fees = paid.flatMap((transaction) => transaction.fees ?? []).reduce((sum, fee) => sum + Math.max(0, shopifyMoneyToCents(fee.amount?.amount)), 0);
  return {
    gid: order.id,
    name: order.name.slice(0, 100),
    test: order.test,
    cancelled: Boolean(order.cancelledAt),
    financial_status: order.displayFinancialStatus ?? "PENDING",
    currency: order.currencyCode,
    ordered_on: parisDate(order.processedAt),
    payment_on: parisDate(firstPayment?.processedAt ?? order.processedAt),
    payment_method: shopifyGatewayToMethod(firstPayment?.gateway ?? paid[0]?.gateway),
    shipping_cents: money(order.totalShippingPriceSet),
    discount_cents: money(order.totalDiscountsSet),
    tax_cents: money(order.totalTaxSet),
    total_cents: money(order.totalPriceSet),
    received_cents: money(order.totalReceivedSet),
    refunded_cents: money(order.totalRefundedSet),
    fee_cents: fees,
    lines: order.lineItems.nodes.filter((line) => line.quantity > 0).map((line) => ({
      title: (line.variantTitle && line.variantTitle !== "Default Title" ? `${line.title} — ${line.variantTitle}` : line.title).slice(0, 300),
      quantity: Math.min(line.quantity, 999),
      unit_price_cents: money(line.originalUnitPriceSet),
      sku: (line.variant?.sku || line.sku || null)?.slice(0, 100) ?? null,
      product_gid: line.product?.id ?? null,
      variant_gid: line.variant?.id ?? null,
    })),
  };
}

/** Nom de la cliente à partir de l'adresse de facturation, ou null s'il est absent ou masqué. */
export function customerNameFrom(data: { order?: { billingAddress?: { firstName?: string | null; lastName?: string | null } | null } | null } | null): string | null {
  const address = data?.order?.billingAddress;
  const name = [address?.firstName, address?.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return name ? name.slice(0, 160) : null;
}

/** Recherche Shopify des commandes payées (ou remboursées ensuite) depuis une date. */
export function shopifyHistoryQuery(since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("SHOPIFY_DATE_INVALID");
  return `created_at:>='${since}' (financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded)`;
}

/** Chevauchement entre deux synchronisations, pour ne manquer aucune commande modifiée pendant un passage. */
const SYNC_OVERLAP_MS = 10 * 60 * 1000;
/** Première synchronisation : les deux derniers jours (l'historique plus ancien s'importe à la demande). */
const FIRST_SYNC_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** Date de modification Shopify à partir de laquelle relire les commandes. */
export function shopifySyncSince(syncedThrough: string | null, now = Date.now()): string {
  const base = syncedThrough ? Date.parse(syncedThrough) - SYNC_OVERLAP_MS : now - FIRST_SYNC_WINDOW_MS;
  if (!Number.isFinite(base)) return new Date(now - FIRST_SYNC_WINDOW_MS).toISOString();
  return new Date(Math.min(base, now)).toISOString();
}

export function shopifyRecentQuery(sinceIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(sinceIso)) throw new Error("SHOPIFY_DATE_INVALID");
  return `updated_at:>='${sinceIso}'`;
}

/**
 * Jusqu'où la synchronisation est acquise : la date de modification de la dernière commande importée
 * avant le premier échec. Les commandes suivantes seront relues au prochain passage.
 */
export function shopifySyncedThrough(results: Array<{ updatedAt: string | undefined; ok: boolean }>): string | null {
  let through: string | null = null;
  for (const result of results) {
    if (!result.ok) break;
    if (result.updatedAt && (!through || result.updatedAt > through)) through = result.updatedAt;
  }
  return through;
}
