import { getTodayInParis } from "../utils/date";
import type { DeclarationPeriod, VatRegime } from "@/types/database";
import type {
  DeclarationCalculationStatus,
  DeclarationUiStatus,
  RegisterTotals,
  TurnoverDeclaration,
} from "@/types/registers";

const SAFE_RANGE_ERROR = "REGISTER_MONETARY_VALUE_OUT_OF_SAFE_RANGE";

function exactInteger(value: unknown): bigint {
  if ((typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") || value === "") throw new Error(SAFE_RANGE_ERROR);
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(SAFE_RANGE_ERROR);
  try {
    const parsed = BigInt(value);
    if (parsed < BigInt(Number.MIN_SAFE_INTEGER) || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(SAFE_RANGE_ERROR);
    return parsed;
  } catch {
    throw new Error(SAFE_RANGE_ERROR);
  }
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(SAFE_RANGE_ERROR);
  return result;
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("REGISTER_INVALID_DATE");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("REGISTER_INVALID_DATE");
  return { year, month, day };
}

function dateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthOffset(year: number, month: number, offset: number): { year: number; month: number } {
  const index = year * 12 + month - 1 + offset;
  return { year: Math.floor(index / 12), month: index % 12 + 1 };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function endOfMonth(year: number, month: number): string {
  return dateString(year, month, lastDayOfMonth(year, month));
}

function nextDay(value: string): string {
  const { year, month, day } = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dueAfter(periodEnd: string): string {
  const { year, month } = parseDate(periodEnd);
  const next = monthOffset(year, month, 1);
  return endOfMonth(next.year, next.month);
}

export function resolveRegisterYear(input: string | string[] | undefined, now = new Date()): number {
  const current = Number(getTodayInParis(now).slice(0, 4));
  if (typeof input !== "string" || !/^\d{4}$/.test(input)) return current;
  const year = Number(input);
  return year >= 1900 && year <= 9999 ? year : current;
}

export interface GeneratedDeclarationPeriod {
  periodStart: string;
  periodEnd: string;
  dueOn: string;
}

export function generateDeclarationPeriods(
  activityStartedOn: string | null,
  declarationPeriod: DeclarationPeriod,
  displayedYear: number,
): GeneratedDeclarationPeriod[] {
  if (activityStartedOn === null) return [];
  const start = parseDate(activityStartedOn);
  if (!Number.isInteger(displayedYear) || displayedYear < 1900 || displayedYear > 9999) throw new Error("REGISTER_INVALID_YEAR");

  let periodStart = activityStartedOn;
  let periodEnd: string;
  if (declarationPeriod === "monthly") {
    const firstEnd = monthOffset(start.year, start.month, 3);
    periodEnd = endOfMonth(firstEnd.year, firstEnd.month);
  } else {
    const startQuarter = Math.floor((start.month - 1) / 3);
    const endMonthIndex = (startQuarter + 2) * 3;
    const endYear = start.year + Math.floor((endMonthIndex - 1) / 12);
    const endMonth = ((endMonthIndex - 1) % 12) + 1;
    periodEnd = endOfMonth(endYear, endMonth);
  }

  const result: GeneratedDeclarationPeriod[] = [];
  for (let guard = 0; guard < 2400; guard++) {
    const endYear = parseDate(periodEnd).year;
    if (endYear === displayedYear) result.push({ periodStart, periodEnd, dueOn: dueAfter(periodEnd) });
    if (endYear > displayedYear) break;
    periodStart = nextDay(periodEnd);
    const next = parseDate(periodStart);
    if (declarationPeriod === "monthly") periodEnd = endOfMonth(next.year, next.month);
    else {
      const quarterEndMonth = (Math.floor((next.month - 1) / 3) + 1) * 3;
      periodEnd = endOfMonth(next.year, quarterEndMonth);
    }
  }
  return result;
}

export function declarationUiStatus(periodEnd: string, dueOn: string, hasDeclaration: boolean, today = getTodayInParis()): DeclarationUiStatus {
  parseDate(periodEnd);
  parseDate(dueOn);
  parseDate(today);
  if (hasDeclaration) return "declared";
  if (today <= periodEnd) return "upcoming";
  if (today <= dueOn) return "to-declare";
  return "overdue";
}

export function calculateDeclarationSuggestion(
  vatRegime: VatRegime,
  payments: Array<{ grossAmountCents: number; platformFeeCents?: number }>,
  refunds: Array<{ amountCents: number }>,
): {
  calculationStatus: DeclarationCalculationStatus;
  suggestedTurnoverCents: number | null;
  grossReceiptsCents: number;
  customerRefundsCents: number;
  paymentCount: number;
  refundCount: number;
} {
  const gross = payments.reduce<bigint>((total, payment) => total + exactInteger(payment.grossAmountCents), BigInt(0));
  const refunded = refunds.reduce<bigint>((total, refund) => total + exactInteger(refund.amountCents), BigInt(0));
  const calculationStatus: DeclarationCalculationStatus = refunds.length > 0
    ? "refund-review-required"
    : vatRegime === "liable" ? "vat-unmodeled" : "available";
  return {
    calculationStatus,
    suggestedTurnoverCents: calculationStatus === "available" ? safeNumber(gross) : null,
    grossReceiptsCents: safeNumber(gross),
    customerRefundsCents: safeNumber(refunded),
    paymentCount: payments.length,
    refundCount: refunds.length,
  };
}

export function adjustmentReasonRequired(suggestedCents: number | null, declaredCents: number): boolean {
  const declared = exactInteger(declaredCents);
  return suggestedCents === null || declared !== exactInteger(suggestedCents);
}

export function validateDeclarationDates(periodEnd: string, submittedOn: string, today = getTodayInParis()): void {
  parseDate(periodEnd);
  parseDate(submittedOn);
  parseDate(today);
  if (periodEnd >= today) throw new Error("DECLARATION_PERIOD_NOT_ENDED");
  if (submittedOn > today) throw new Error("DECLARATION_SUBMITTED_IN_FUTURE");
}

export function calculateRegisterTotals<T>(rows: T[], dateOf: (row: T) => string, amountOf: (row: T) => number): RegisterTotals {
  const quarters = [BigInt(0), BigInt(0), BigInt(0), BigInt(0)];
  for (const row of rows) {
    const { month } = parseDate(dateOf(row));
    quarters[Math.floor((month - 1) / 3)] += exactInteger(amountOf(row));
  }
  return {
    quarterCents: quarters.map(safeNumber) as [number, number, number, number],
    annualCents: safeNumber(quarters.reduce((total, amount) => total + amount, BigInt(0))),
  };
}

export function latestDeclaredAnnualTotal(declarations: TurnoverDeclaration[]): number {
  const latest = new Map<string, TurnoverDeclaration>();
  for (const declaration of declarations) {
    const key = `${declaration.periodStart}:${declaration.periodEnd}`;
    const previous = latest.get(key);
    if (!previous || declaration.revisionNo > previous.revisionNo) latest.set(key, declaration);
  }
  return safeNumber([...latest.values()].reduce((total, declaration) => total + exactInteger(declaration.declaredTurnoverCents), BigInt(0)));
}

export function turnoverDifference(suggestedCents: number | null, declaredCents: number): number | null {
  if (suggestedCents === null) return null;
  return safeNumber(exactInteger(declaredCents) - exactInteger(suggestedCents));
}
