import type {
  BreakEvenUnavailableReason,
  DashboardMetrics,
  DashboardMonth,
  DashboardRecurringTemplate,
  DashboardSaleCosting,
  DashboardSourceData,
} from "@/types/dashboard";
import { calculateProfessionalAmount } from "../expenses/calculations";

const SAFE_RANGE_ERROR = "DASHBOARD_MONETARY_VALUE_OUT_OF_SAFE_RANGE";
const EXCLUDED_FIXED_CATEGORIES = new Set(["raw_materials", "packaging", "taxes_social"]);

function exactInteger(value: unknown): bigint {
  if ((typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") || value === "") {
    throw new Error(SAFE_RANGE_ERROR);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(SAFE_RANGE_ERROR);
  try {
    const result = BigInt(value);
    if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(SAFE_RANGE_ERROR);
    return result;
  } catch {
    throw new Error(SAFE_RANGE_ERROR);
  }
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(SAFE_RANGE_ERROR);
  return result;
}

function sum(values: unknown[]): bigint {
  return values.reduce<bigint>((total, value) => total + exactInteger(value), BigInt(0));
}

function roundPositiveRatio(numerator: bigint, denominator: bigint): bigint {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new Error("DASHBOARD_INVALID_RATIO");
  return (numerator + denominator / BigInt(2)) / denominator;
}

function ceilPositiveRatio(numerator: bigint, denominator: bigint): bigint {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new Error("DASHBOARD_INVALID_RATIO");
  return (numerator + denominator - BigInt(1)) / denominator;
}

function ratioBasisPoints(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= BigInt(0)) return null;
  return safeNumber((numerator * BigInt(10000)) / denominator);
}

function utcDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function currentParisMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("DASHBOARD_MONTH_RESOLUTION_FAILED");
  return `${year}-${month}`;
}

export function resolveDashboardMonth(input: string | string[] | undefined, now = new Date()): DashboardMonth {
  const requested = typeof input === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(input) ? input : currentParisMonth(now);
  const [year, month] = requested.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = `${requested}-01`;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(nextYear, nextMonth - 1, 1));
  endDate.setUTCDate(endDate.getUTCDate() - 90);
  return {
    key: requested,
    start,
    end,
    referenceStart: utcDateString(endDate),
    label: new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 1)),
    ),
  };
}

function professionalAmount(template: DashboardRecurringTemplate): bigint {
  return exactInteger(calculateProfessionalAmount(template.estimatedAmountCents, template.professionalShareBasisPoints));
}

function isEligibleFixedCost(template: DashboardRecurringTemplate): boolean {
  return template.isActive
    && template.nature === "operating"
    && template.costBehavior === "fixed"
    && !EXCLUDED_FIXED_CATEGORIES.has(template.category);
}

function annualFrequency(frequency: DashboardRecurringTemplate["frequency"]): bigint {
  if (frequency === "monthly") return BigInt(12);
  if (frequency === "quarterly") return BigInt(4);
  return BigInt(1);
}

function aggregateCompleteSales(sales: DashboardSaleCosting[]) {
  let merchandiseRevenue = BigInt(0);
  let manufacturingCost = BigInt(0);
  let manufacturingMargin = BigInt(0);
  let completeCount = 0;
  let incompleteCount = 0;
  let historicalCount = 0;

  for (const sale of sales) {
    if (sale.status !== "validated") continue;
    if (sale.costingComplete && !sale.costingEvaluated) throw new Error("DASHBOARD_INCONSISTENT_COSTING");
    if (!sale.costingEvaluated) {
      historicalCount++;
      continue;
    }
    if (!sale.costingComplete) {
      incompleteCount++;
      continue;
    }
    if (sale.manufacturingCostCents === null || sale.manufacturingMarginCents === null) {
      throw new Error("DASHBOARD_INCONSISTENT_COSTING");
    }
    const merchandise = exactInteger(sale.subtotalCents) - exactInteger(sale.discountCents);
    const cost = exactInteger(sale.manufacturingCostCents);
    const margin = exactInteger(sale.manufacturingMarginCents);
    if (merchandise - cost !== margin) throw new Error("DASHBOARD_INCONSISTENT_COSTING");
    merchandiseRevenue += merchandise;
    manufacturingCost += cost;
    manufacturingMargin += margin;
    completeCount++;
  }

  return { merchandiseRevenue, manufacturingCost, manufacturingMargin, completeCount, incompleteCount, historicalCount };
}

export function calculateDashboardMetrics(source: DashboardSourceData): DashboardMetrics {
  const grossCollected = sum(source.payments.map((payment) => payment.grossAmountCents));
  const customerRefunded = sum(source.customerRefunds.map((refund) => refund.amountCents));
  const platformFees = sum(source.payments.map((payment) => payment.platformFeeCents));
  const expensesPaid = sum(source.expensePayments.map((payment) => payment.businessAmountCents));
  const expenseRefunded = sum(source.expenseRefunds.map((refund) => refund.businessAmountCents));
  const revenueCollected = grossCollected - customerRefunded;
  const netExpenses = expensesPaid - expenseRefunded;
  const trackedCash = revenueCollected - platformFees - netExpenses;

  const validatedMonthlySales = source.monthlySales.filter((sale) => sale.status === "validated");
  const validatedReferenceSales = source.referenceSales.filter((sale) => sale.status === "validated");
  const monthly = aggregateCompleteSales(validatedMonthlySales);
  const reference = aggregateCompleteSales(validatedReferenceSales);
  const eligibleTemplates = source.recurringTemplates.filter(isEligibleFixedCost);
  const annualFixed = eligibleTemplates.reduce(
    (total, template) => total + professionalAmount(template) * annualFrequency(template.frequency),
    BigInt(0),
  );
  const monthlyFixed = eligibleTemplates.length > 0 ? roundPositiveRatio(annualFixed, BigInt(12)) : null;

  let unavailableReason: BreakEvenUnavailableReason | null = null;
  let breakEven: bigint | null = null;
  if (eligibleTemplates.length === 0) unavailableReason = "fixed-costs-not-configured";
  else if (reference.completeCount === 0) unavailableReason = "no-reference-sales";
  else if (reference.merchandiseRevenue <= BigInt(0)) unavailableReason = "non-positive-reference-revenue";
  else if (reference.manufacturingMargin <= BigInt(0)) unavailableReason = "non-positive-reference-margin";
  else breakEven = ceilPositiveRatio(annualFixed * reference.merchandiseRevenue, BigInt(12) * reference.manufacturingMargin);

  const allMonthlySalesComplete = validatedMonthlySales.length > 0 && monthly.completeCount === validatedMonthlySales.length;
  const coverageDelta = allMonthlySalesComplete && monthlyFixed !== null
    ? monthly.manufacturingMargin - monthlyFixed
    : null;

  return {
    cash: {
      grossCollectedCents: safeNumber(grossCollected),
      customerRefundedCents: safeNumber(customerRefunded),
      revenueCollectedCents: safeNumber(revenueCollected),
      platformFeesCents: safeNumber(platformFees),
      expensesPaidCents: safeNumber(expensesPaid),
      expenseRefundedCents: safeNumber(expenseRefunded),
      netExpensesCents: safeNumber(netExpenses),
      trackedCashCents: safeNumber(trackedCash),
    },
    profitability: {
      saleCount: validatedMonthlySales.length,
      completeCount: monthly.completeCount,
      incompleteCount: monthly.incompleteCount,
      historicalCount: monthly.historicalCount,
      completeMerchandiseRevenueCents: safeNumber(monthly.merchandiseRevenue),
      manufacturingCostCents: safeNumber(monthly.manufacturingCost),
      manufacturingMarginCents: safeNumber(monthly.manufacturingMargin),
      marginRateBasisPoints: ratioBasisPoints(monthly.manufacturingMargin, monthly.merchandiseRevenue),
    },
    fixedCosts: {
      eligibleTemplateCount: eligibleTemplates.length,
      monthlyCents: monthlyFixed === null ? null : safeNumber(monthlyFixed),
      annualCents: eligibleTemplates.length === 0 ? null : safeNumber(annualFixed),
    },
    reference: {
      saleCount: reference.completeCount,
      merchandiseRevenueCents: safeNumber(reference.merchandiseRevenue),
      manufacturingMarginCents: safeNumber(reference.manufacturingMargin),
      marginRateBasisPoints: ratioBasisPoints(reference.manufacturingMargin, reference.merchandiseRevenue),
    },
    breakEven: {
      monthlyRevenueCents: breakEven === null ? null : safeNumber(breakEven),
      unavailableReason,
    },
    fixedCostCoverageDeltaCents: coverageDelta === null ? null : safeNumber(coverageDelta),
    missingDocumentCount: source.missingDocuments.filter((expense) => expense.documentCount === 0).length,
  };
}
