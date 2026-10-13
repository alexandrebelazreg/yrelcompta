import type { DashboardRecurringTemplate } from "@/types/dashboard";
import { calculateProfessionalAmount } from "../expenses/calculations";
import { annualFrequency, isEligibleFixedCost } from "../dashboard/calculations";

const SAFE_RANGE_ERROR = "PROFITABILITY_VALUE_OUT_OF_SAFE_RANGE";

export interface ProfitabilityFixedCharge extends DashboardRecurringTemplate {
  id: string;
  description: string;
}

export interface ProfitabilityEquipmentExpense {
  id: string;
  description: string;
  purchasedOn: string;
  businessAmountCents: number;
}

/** Marge de référence : ventes complètes récentes, sinon catalogue des produits actifs. */
export interface ProfitabilityMarginReference {
  source: "sales" | "catalog";
  revenueCents: number;
  marginCents: number;
  count: number;
}

export interface ProfitabilityInput {
  charges: ProfitabilityFixedCharge[];
  equipment: ProfitabilityEquipmentExpense[];
  reference: ProfitabilityMarginReference | null;
  catalog: { priceTotalCents: number; productCount: number };
  /** Cotisations sociales + CFP + versement libératoire, en points de base du CA ; null si non estimable. */
  levyRateBasisPoints: number | null;
}

export type ProfitabilityUnavailableReason = "no-costs" | "no-margin-reference" | "non-positive-margin" | "levy-exceeds-margin";

export interface ProfitabilityPlan {
  chargeLines: Array<{ id: string; description: string; frequency: DashboardRecurringTemplate["frequency"]; professionalAmountCents: number; monthlyCents: number }>;
  recurringMonthlyCents: number;
  equipmentTotalCents: number;
  equipmentMonthlyCents: number;
  monthlyToCoverCents: number;
  marginRateBasisPoints: number | null;
  breakEvenRevenueCents: number | null;
  breakEvenAfterLevyCents: number | null;
  unitsPerMonth: number | null;
  unavailableReason: ProfitabilityUnavailableReason | null;
}

function exactInteger(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new Error(SAFE_RANGE_ERROR);
  return BigInt(value);
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(SAFE_RANGE_ERROR);
  return result;
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function ceilRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

export function calculateProfitabilityPlan(input: ProfitabilityInput): ProfitabilityPlan {
  const twelve = BigInt(12);
  const eligible = input.charges.filter(isEligibleFixedCost);
  const chargeLines = eligible.map((charge) => {
    const professional = exactInteger(calculateProfessionalAmount(charge.estimatedAmountCents, charge.professionalShareBasisPoints));
    const annual = professional * annualFrequency(charge.frequency);
    return { id: charge.id, description: charge.description, frequency: charge.frequency, professionalAmountCents: safeNumber(professional), monthlyCents: safeNumber(roundRatio(annual, twelve)), annual };
  });
  const annualRecurring = chargeLines.reduce((total, line) => total + line.annual, BigInt(0));
  // Le matériel acheté sur les 12 derniers mois est lissé sur une année.
  const equipmentTotal = input.equipment.reduce((total, expense) => total + exactInteger(expense.businessAmountCents), BigInt(0));
  const annualToCover = annualRecurring + equipmentTotal;

  const revenue = input.reference ? exactInteger(input.reference.revenueCents) : BigInt(0);
  const margin = input.reference ? exactInteger(input.reference.marginCents) : BigInt(0);
  const marginRateBasisPoints = revenue > BigInt(0) ? safeNumber((margin * BigInt(10000)) / revenue) : null;

  let unavailableReason: ProfitabilityUnavailableReason | null = null;
  let breakEven: bigint | null = null;
  let breakEvenAfterLevy: bigint | null = null;
  if (annualToCover === BigInt(0)) unavailableReason = "no-costs";
  else if (!input.reference || revenue <= BigInt(0)) unavailableReason = "no-margin-reference";
  else if (margin <= BigInt(0)) unavailableReason = "non-positive-margin";
  else {
    breakEven = ceilRatio(annualToCover * revenue, twelve * margin);
    if (input.levyRateBasisPoints !== null) {
      // Chaque euro vendu rapporte (marge − cotisations) : seuil = charges / (taux de marge − taux de prélèvement).
      const netContribution = margin * BigInt(10000) - exactInteger(input.levyRateBasisPoints) * revenue;
      if (netContribution <= BigInt(0)) unavailableReason = "levy-exceeds-margin";
      else breakEvenAfterLevy = ceilRatio(annualToCover * revenue * BigInt(10000), twelve * netContribution);
    }
  }

  const target = breakEvenAfterLevy ?? breakEven;
  const priceTotal = exactInteger(input.catalog.priceTotalCents);
  const unitsPerMonth = target !== null && priceTotal > BigInt(0) && input.catalog.productCount > 0
    ? safeNumber(ceilRatio(target * exactInteger(input.catalog.productCount), priceTotal))
    : null;

  return {
    chargeLines: chargeLines.map((line) => ({ id: line.id, description: line.description, frequency: line.frequency, professionalAmountCents: line.professionalAmountCents, monthlyCents: line.monthlyCents })),
    recurringMonthlyCents: safeNumber(roundRatio(annualRecurring, twelve)),
    equipmentTotalCents: safeNumber(equipmentTotal),
    equipmentMonthlyCents: safeNumber(roundRatio(equipmentTotal, twelve)),
    monthlyToCoverCents: safeNumber(roundRatio(annualToCover, twelve)),
    marginRateBasisPoints,
    breakEvenRevenueCents: breakEven === null ? null : safeNumber(breakEven),
    breakEvenAfterLevyCents: breakEvenAfterLevy === null ? null : safeNumber(breakEvenAfterLevy),
    unitsPerMonth,
    unavailableReason,
  };
}
