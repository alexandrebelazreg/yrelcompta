import type { BillingCommercialState, BillingDocumentKind } from "@/types/invoicing";

export const INVOICING_SAFE_RANGE_ERROR = "INVOICING_MONETARY_VALUE_OUT_OF_SAFE_RANGE";

export function invoicingBigInt(value: unknown): bigint {
  if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") || value === "") throw new Error(INVOICING_SAFE_RANGE_ERROR);
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(INVOICING_SAFE_RANGE_ERROR);
  try {
    const parsed = BigInt(value);
    if (parsed < BigInt(Number.MIN_SAFE_INTEGER) || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(INVOICING_SAFE_RANGE_ERROR);
    return parsed;
  } catch {
    throw new Error(INVOICING_SAFE_RANGE_ERROR);
  }
}

export function invoicingSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(INVOICING_SAFE_RANGE_ERROR);
  return result;
}

export function sumInvoiceCents(values: Array<number | string | bigint>): number {
  return invoicingSafeNumber(values.reduce<bigint>((total, value) => total + invoicingBigInt(value), BigInt(0)));
}

export function billingCommercialState(kind: BillingDocumentKind, totalCents: number, creditedCents: number): BillingCommercialState {
  if (kind === "credit_note") return "credit-note";
  const total = invoicingBigInt(totalCents);
  const credited = invoicingBigInt(creditedCents);
  if (credited === BigInt(0)) return "invoice";
  return credited >= total ? "fully-credited" : "partially-credited";
}

export function formatDocumentNumber(kind: BillingDocumentKind, year: number, value: bigint): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 || value <= BigInt(0)) throw new Error("INVALID_BILLING_NUMBER_INPUT");
  return `${kind === "invoice" ? "FAC" : "AV"}-${year}-${value.toString().padStart(6, "0")}`;
}

export function deterministicPdfFilename(kind: BillingDocumentKind, number: string): string {
  if (!/^(FAC|AV)-\d{4}-\d{6,}$/.test(number)) throw new Error("INVALID_BILLING_NUMBER");
  return `${kind === "invoice" ? "facture" : "avoir"}-${number}.pdf`;
}
