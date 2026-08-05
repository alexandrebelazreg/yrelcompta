import type { Sale, SaleFinancialSummary, SalesTotals } from "@/types/sales";

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
  return items.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0);
}

export function calculateSaleTotal(items: Array<{ quantity: number; unit_price_cents: number }>, shippingCents: number, discountCents: number): number {
  return Math.max(0, calculateSaleSubtotal(items) + shippingCents - discountCents);
}

type FinancialPayment = { gross_amount_cents: number; platform_fee_cents: number; refunds: Array<{ amount_cents: number }> };
type DatedPayment = FinancialPayment & { received_on: string; refunds: Array<{ amount_cents: number; refunded_on: string }> };
export type SalesTotalsSource = { status: Sale["status"]; total_cents: number; payments: FinancialPayment[] };

export function calculateSaleFinancials(sale: { status: Sale["status"]; total_cents: number; payments: FinancialPayment[] }): SaleFinancialSummary {
  const grossPaidCents = sale.payments.reduce((sum, payment) => sum + payment.gross_amount_cents, 0);
  const platformFeesCents = sale.payments.reduce((sum, payment) => sum + payment.platform_fee_cents, 0);
  const refundedCents = sale.payments.reduce((sum, payment) => sum + payment.refunds.reduce((refundSum, refund) => refundSum + refund.amount_cents, 0), 0);
  return {
    totalCents: sale.total_cents,
    grossPaidCents,
    platformFeesCents,
    netDepositedCents: grossPaidCents - platformFeesCents,
    refundedCents,
    netCollectedCents: grossPaidCents - refundedCents,
    remainingCents: sale.status === "cancelled" ? 0 : Math.max(0, sale.total_cents - grossPaidCents),
  };
}

export function calculateSalesTotals(sales: SalesTotalsSource[]): SalesTotals {
  return sales.reduce<SalesTotals>((totals, sale) => {
    const summary = calculateSaleFinancials(sale);
    if (sale.status === "validated") totals.validatedSalesCents += sale.total_cents;
    totals.totalCents += summary.totalCents;
    totals.grossPaidCents += summary.grossPaidCents;
    totals.platformFeesCents += summary.platformFeesCents;
    totals.netDepositedCents += summary.netDepositedCents;
    totals.refundedCents += summary.refundedCents;
    totals.netCollectedCents += summary.netCollectedCents;
    if (sale.status === "validated") totals.remainingCents += summary.remainingCents;
    return totals;
  }, { validatedSalesCents: 0, totalCents: 0, grossPaidCents: 0, platformFeesCents: 0, netDepositedCents: 0, refundedCents: 0, netCollectedCents: 0, remainingCents: 0 });
}

export function calculateMonthlyRevenue(payments: DatedPayment[], startDate: string, endDateExclusive: string): number {
  const gross = payments.filter((payment) => payment.received_on >= startDate && payment.received_on < endDateExclusive).reduce((sum, payment) => sum + payment.gross_amount_cents, 0);
  const refunds = payments.flatMap((payment) => payment.refunds).filter((refund) => refund.refunded_on >= startDate && refund.refunded_on < endDateExclusive).reduce((sum, refund) => sum + refund.amount_cents, 0);
  return gross - refunds;
}
