import type {
  AcreRuleVersion,
  BusinessFiscalProfile,
  DashboardFiscalReserve,
  FiscalCalculationContext,
  FiscalReserveCalculation,
  FiscalSocialRuleVersion,
} from "@/types/fiscal-social";

const BASIS_POINTS = BigInt(10_000);
const SAFE_RANGE_ERROR = "FISCAL_MONETARY_VALUE_OUT_OF_SAFE_RANGE";

function exactInteger(value: number | string | bigint): bigint {
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

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("FISCAL_INVALID_DATE");
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addUtcMonths(date: string, months: number): string {
  assertIsoDate(date);
  const [year, month, day] = date.split("-").map(Number);
  const absoluteMonth = year * 12 + month - 1 + months;
  const nextYear = Math.floor(absoluteMonth / 12);
  const nextMonth = absoluteMonth % 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, daysInUtcMonth(nextYear, nextMonth))).padStart(2, "0")}`;
}

export function previousIsoDate(date: string): string {
  assertIsoDate(date);
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function resolveVersionAtDate<T>(versions: T[], date: string, effectiveFrom: (version: T) => string): T | null {
  assertIsoDate(date);
  return versions.reduce<T | null>((latest, version) => {
    const effective = effectiveFrom(version);
    assertIsoDate(effective);
    if (effective > date || (latest && effectiveFrom(latest) >= effective)) return latest;
    return version;
  }, null);
}

export function calculateAcreEndDate(activityStartedOn: string, durationQuartersAfterStart: number): string {
  assertIsoDate(activityStartedOn);
  if (!Number.isSafeInteger(durationQuartersAfterStart) || durationQuartersAfterStart < 0) throw new Error("FISCAL_INVALID_ACRE_DURATION");
  const [year, month] = activityStartedOn.split("-").map(Number);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const quarterStart = `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
  return previousIsoDate(addUtcMonths(quarterStart, (durationQuartersAfterStart + 1) * 3));
}

export function roundRateUpToIncrement(
  normalRateBasisPoints: number | string | bigint,
  paidFractionBasisPoints: number | string | bigint,
  incrementBasisPoints: number | string | bigint,
): number {
  const normal = exactInteger(normalRateBasisPoints);
  const fraction = exactInteger(paidFractionBasisPoints);
  const increment = exactInteger(incrementBasisPoints);
  if (normal < BigInt(0) || fraction < BigInt(0) || increment <= BigInt(0)) throw new Error("FISCAL_INVALID_RATE");
  const divisor = BASIS_POINTS * increment;
  return safeNumber(((normal * fraction + divisor - BigInt(1)) / divisor) * increment);
}

export function roundFiscalAmount(turnoverCents: number | string | bigint, rateBasisPoints: number | string | bigint): number {
  const turnover = exactInteger(turnoverCents);
  const rate = exactInteger(rateBasisPoints);
  if (turnover < BigInt(0) || rate < BigInt(0)) throw new Error("FISCAL_INVALID_AMOUNT");
  return safeNumber((turnover * rate + BASIS_POINTS / BigInt(2)) / BASIS_POINTS);
}

function effectiveSocialRate(
  date: string,
  activityStartedOn: string,
  profile: BusinessFiscalProfile,
  rule: FiscalSocialRuleVersion,
  acreRule: AcreRuleVersion | null,
): { rate: number; applied: boolean; endsOn: string | null } {
  if (!profile.hasAcre) return { rate: rule.socialContributionBasisPoints, applied: false, endsOn: null };
  if (!acreRule) throw new Error("FISCAL_ACRE_RULE_REQUIRED");
  const endsOn = calculateAcreEndDate(activityStartedOn, acreRule.durationQuartersAfterStart);
  const applied = date >= activityStartedOn && date <= endsOn;
  return {
    rate: applied
      ? roundRateUpToIncrement(
        rule.socialContributionBasisPoints,
        acreRule.paidFractionBasisPoints,
        acreRule.rateRoundingIncrementBasisPoints,
      )
      : rule.socialContributionBasisPoints,
    applied,
    endsOn,
  };
}

export function calculateFiscalReserve(
  turnoverCents: number | string | bigint,
  calculationDate: string,
  activityStartedOn: string,
  profile: BusinessFiscalProfile,
  rule: FiscalSocialRuleVersion,
  acreRule: AcreRuleVersion | null,
): FiscalReserveCalculation {
  assertIsoDate(calculationDate);
  const turnover = safeNumber(exactInteger(turnoverCents));
  const social = effectiveSocialRate(calculationDate, activityStartedOn, profile, rule, acreRule);
  const cfpRate = profile.cfpCategory === "commercial" ? rule.cfpCommercialBasisPoints : rule.cfpArtisanBasisPoints;
  const versementRate = profile.versementLiberatoire ? rule.versementLiberatoireBasisPoints : 0;
  const socialAmount = roundFiscalAmount(turnover, social.rate);
  const cfpAmount = roundFiscalAmount(turnover, cfpRate);
  const incomeTaxAmount = roundFiscalAmount(turnover, versementRate);
  return {
    turnoverCents: turnover,
    socialRateBasisPoints: social.rate,
    cfpRateBasisPoints: cfpRate,
    versementLiberatoireBasisPoints: versementRate,
    acreApplied: social.applied,
    acreEndsOn: social.endsOn,
    estimatedSocialContributionsCents: socialAmount,
    estimatedCfpCents: cfpAmount,
    estimatedIncomeTaxCents: incomeTaxAmount,
    estimatedTotalReserveCents: safeNumber(exactInteger(socialAmount) + exactInteger(cfpAmount) + exactInteger(incomeTaxAmount)),
  };
}

export function calculateDashboardFiscalReserve(input: {
  grossCollectedCents: number;
  customerRefundCount: number;
  trackedCashCents: number;
  calculationDate: string;
  context: FiscalCalculationContext;
}): DashboardFiscalReserve {
  if (input.customerRefundCount > 0) return { calculation: null, unavailableReason: "refund-review-required", trackedCashAfterReserveCents: null };
  if (input.context.vatRegime === "liable") return { calculation: null, unavailableReason: "vat-unmodeled", trackedCashAfterReserveCents: null };
  if (!input.context.profile || !input.context.activityStartedOn) return { calculation: null, unavailableReason: "profile-not-configured", trackedCashAfterReserveCents: null };
  if (!input.context.rule || (input.context.profile.hasAcre && !input.context.acreRule)) {
    return { calculation: null, unavailableReason: "rule-not-available", trackedCashAfterReserveCents: null };
  }
  const calculation = calculateFiscalReserve(
    input.grossCollectedCents,
    input.calculationDate,
    input.context.activityStartedOn,
    input.context.profile,
    input.context.rule,
    input.context.acreRule,
  );
  return {
    calculation,
    unavailableReason: null,
    trackedCashAfterReserveCents: safeNumber(exactInteger(input.trackedCashCents) - exactInteger(calculation.estimatedTotalReserveCents)),
  };
}
