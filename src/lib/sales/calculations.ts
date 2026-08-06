import type { Sale, SaleFinancialSummary, SalesTotals } from "@/types/sales";

export const UNSAFE_MONEY_ERROR = "MONETARY_VALUE_OUT_OF_SAFE_RANGE";

export function toSafeIntegerAmount(value: unknown): number {
  if (typeof value === "bigint") {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error(UNSAFE_MONEY_ERROR);
    return result;
  }
  if ((typeof value !== "number" && typeof value !== "string") || value === "") throw new Error(UNSAFE_MONEY_ERROR);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(UNSAFE_MONEY_ERROR);
  return result;
}

function safeBigIntResult(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(UNSAFE_MONEY_ERROR);
  return result;
}

export function sumSafeAmounts(values: number[]): number {
  let total = BigInt(0);
  for (const value of values) total += BigInt(toSafeIntegerAmount(value));
  return safeBigIntResult(total);
}

function subtractSafeAmounts(first: number, ...values: number[]): number {
  let total = BigInt(toSafeIntegerAmount(first));
  for (const value of values) total -= BigInt(toSafeIntegerAmount(value));
  return safeBigIntResult(total);
}

export function parseFrenchMoneyToCents(input: string): number {
  const normalized = input.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) throw new Error("Montant invalide");
  const [euros, decimals = ""] = normalized.replace(",", ".").split(".");
  const cents = BigInt(euros) * BigInt(100) + BigInt(decimals.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Montant trop élevé");
  return Number(cents);
}

export function formatEuroCents(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents)) throw new Error("Le montant en centimes doit être un entier sûr.");
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 })
    .format(amountCents / 100).replace(/\u00a0/g, "\u202f");
}

export function calculateSaleSubtotal(items: Array<{ quantity: number; unit_price_cents: number }>): number {
  let subtotal = BigInt(0);
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || !Number.isSafeInteger(item.unit_price_cents)) throw new Error(UNSAFE_MONEY_ERROR);
    subtotal += BigInt(item.quantity) * BigInt(item.unit_price_cents);
  }
  return safeBigIntResult(subtotal);
}

export function calculateSaleTotal(items: Array<{ quantity: number; unit_price_cents: number }>, shippingCents: number, discountCents: number): number {
  if (!Number.isSafeInteger(shippingCents) || !Number.isSafeInteger(discountCents)) throw new Error(UNSAFE_MONEY_ERROR);
  const total = BigInt(calculateSaleSubtotal(items)) + BigInt(shippingCents) - BigInt(discountCents);
  return safeBigIntResult(total < BigInt(0) ? BigInt(0) : total);
}

export type HistoricalCostItem = {
  product_id: string | null;
  line_manufacturing_cost_cents: number | null;
  unit_manufacturing_cost_cents: number | null;
};

export function hasIncompleteHistoricalCost(items: HistoricalCostItem[]): boolean {
  return items.length === 0 || items.some((item) => item.product_id === null || item.line_manufacturing_cost_cents === null || item.unit_manufacturing_cost_cents === null);
}

export function calculateHistoricalManufacturingCost(items: HistoricalCostItem[]): number | null {
  if (hasIncompleteHistoricalCost(items)) return null;
  let total = BigInt(0);
  for (const item of items) total += BigInt(toSafeIntegerAmount(item.line_manufacturing_cost_cents));
  return safeBigIntResult(total);
}

export function calculateLineManufacturingCost(quantity: number, unitCostCents: number): number {
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(unitCostCents)) throw new Error(UNSAFE_MONEY_ERROR);
  return safeBigIntResult(BigInt(quantity) * BigInt(unitCostCents));
}

export function calculateManufacturingMarginAfterDiscount(subtotalCents: number, discountCents: number, manufacturingCostCents: number): number {
  if (![subtotalCents, discountCents, manufacturingCostCents].every(Number.isSafeInteger)) throw new Error(UNSAFE_MONEY_ERROR);
  return safeBigIntResult(BigInt(subtotalCents) - BigInt(discountCents) - BigInt(manufacturingCostCents));
}

export function calculateManufacturingMarginRate(subtotalCents: number, discountCents: number, marginCents: number): number | null {
  if (![subtotalCents, discountCents, marginCents].every(Number.isSafeInteger)) throw new Error(UNSAFE_MONEY_ERROR);
  const denominator = BigInt(subtotalCents) - BigInt(discountCents);
  if (denominator <= BigInt(0)) return null;
  return safeBigIntResult((BigInt(marginCents) * BigInt(10000)) / denominator) / 100;
}

type FinancialPayment = { gross_amount_cents: number; platform_fee_cents: number; refunds: Array<{ amount_cents: number }> };
type DatedPayment = FinancialPayment & { received_on: string; refunds: Array<{ amount_cents: number; refunded_on: string }> };
export type SalesTotalsSource = { status: Sale["status"]; total_cents: number; payments: FinancialPayment[] };

export function calculateSaleFinancials(sale: { status: Sale["status"]; total_cents: number; payments: FinancialPayment[] }): SaleFinancialSummary {
  const grossPaidCents = sumSafeAmounts(sale.payments.map((payment) => payment.gross_amount_cents));
  const platformFeesCents = sumSafeAmounts(sale.payments.map((payment) => payment.platform_fee_cents));
  const refundedCents = sumSafeAmounts(sale.payments.flatMap((payment) => payment.refunds.map((refund) => refund.amount_cents)));
  return {
    totalCents: sale.total_cents,
    grossPaidCents,
    platformFeesCents,
    netDepositedCents: subtractSafeAmounts(grossPaidCents, platformFeesCents),
    refundedCents,
    netCollectedCents: subtractSafeAmounts(grossPaidCents, refundedCents),
    remainingCents: sale.status === "cancelled" ? 0 : Math.max(0, subtractSafeAmounts(sale.total_cents, grossPaidCents)),
  };
}

export function calculateSalesTotals(sales: SalesTotalsSource[]): SalesTotals {
  return sales.reduce<SalesTotals>((totals, sale) => {
    const summary = calculateSaleFinancials(sale);
    if (sale.status === "validated") totals.validatedSalesCents = sumSafeAmounts([totals.validatedSalesCents, sale.total_cents]);
    totals.totalCents = sumSafeAmounts([totals.totalCents, summary.totalCents]);
    totals.grossPaidCents = sumSafeAmounts([totals.grossPaidCents, summary.grossPaidCents]);
    totals.platformFeesCents = sumSafeAmounts([totals.platformFeesCents, summary.platformFeesCents]);
    totals.netDepositedCents = sumSafeAmounts([totals.netDepositedCents, summary.netDepositedCents]);
    totals.refundedCents = sumSafeAmounts([totals.refundedCents, summary.refundedCents]);
    totals.netCollectedCents = sumSafeAmounts([totals.netCollectedCents, summary.netCollectedCents]);
    if (sale.status === "validated") totals.remainingCents = sumSafeAmounts([totals.remainingCents, summary.remainingCents]);
    return totals;
  }, { validatedSalesCents: 0, totalCents: 0, grossPaidCents: 0, platformFeesCents: 0, netDepositedCents: 0, refundedCents: 0, netCollectedCents: 0, remainingCents: 0 });
}

export function calculateMonthlyRevenue(payments: DatedPayment[], startDate: string, endDateExclusive: string): number {
  const gross = sumSafeAmounts(payments.filter((payment) => payment.received_on >= startDate && payment.received_on < endDateExclusive).map((payment) => payment.gross_amount_cents));
  const refunds = sumSafeAmounts(payments.flatMap((payment) => payment.refunds).filter((refund) => refund.refunded_on >= startDate && refund.refunded_on < endDateExclusive).map((refund) => refund.amount_cents));
  return subtractSafeAmounts(gross, refunds);
}
