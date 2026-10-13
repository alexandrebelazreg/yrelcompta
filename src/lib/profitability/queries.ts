import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadAllDashboardPages } from "@/lib/dashboard/pagination";
import { listRecurringTemplates } from "@/lib/expenses/queries";
import { calculateDashboardFiscalReserve } from "@/lib/fiscal-social/calculations";
import { getFiscalCalculationContext } from "@/lib/fiscal-social/queries";
import { listProducts } from "@/lib/products/queries";
import { toSafeIntegerAmount } from "@/lib/sales/calculations";
import { getTodayInParis } from "@/lib/utils/date";
import type { ProfitabilityEquipmentExpense, ProfitabilityInput, ProfitabilityMarginReference } from "./calculations";

const FAILURE_CODE = "PROFITABILITY_DATA_LOAD_FAILED";
const REFERENCE_DAYS = 90;

function logLoadError(code: string | undefined) {
  console.error("Lecture de la rentabilité impossible", { code });
}

function shiftIsoDate(date: string, days: number, years = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year + years, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Taux cumulé cotisations + CFP + versement libératoire, si le profil fiscal permet de l’estimer. */
async function loadLevyRateBasisPoints(businessId: string, today: string): Promise<number | null> {
  try {
    const context = await getFiscalCalculationContext(businessId, today);
    const reserve = calculateDashboardFiscalReserve({ grossCollectedCents: 1_000_000, customerRefundCount: 0, trackedCashCents: 0, calculationDate: today, context });
    if (!reserve.calculation) return null;
    const { socialRateBasisPoints, cfpRateBasisPoints, versementLiberatoireBasisPoints } = reserve.calculation;
    return socialRateBasisPoints + cfpRateBasisPoints + versementLiberatoireBasisPoints;
  } catch {
    return null;
  }
}

export interface ProfitabilityData extends ProfitabilityInput {
  today: string;
  equipmentSince: string;
}

export async function getProfitabilityData(businessId: string): Promise<ProfitabilityData> {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE_CODE);
  const today = getTodayInParis();
  const equipmentSince = shiftIsoDate(today, 1, -1);
  const referenceSince = shiftIsoDate(today, -REFERENCE_DAYS);

  // Matériel et investissements ponctuels ; les charges générées par un modèle récurrent sont déjà comptées.
  const equipmentRows = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("expenses")
      .select("id,description,purchased_on,business_amount_cents,nature")
      .eq("business_id", businessId).eq("status", "validated").is("recurring_template_id", null)
      .gte("purchased_on", equipmentSince).lte("purchased_on", today)
      .or("category.eq.equipment,nature.eq.investment")
      .order("purchased_on", { ascending: false }).order("id").range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError);

  const referenceRows = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("sales")
      .select("subtotal_cents,discount_cents,manufacturing_margin_cents")
      .eq("business_id", businessId).eq("status", "validated")
      .eq("costing_complete", true).eq("costing_evaluated", true)
      .gte("ordered_on", referenceSince).lte("ordered_on", today)
      .order("id").range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError);

  const [templates, equipmentData, salesData, products, levyRateBasisPoints] = await Promise.all([
    listRecurringTemplates(businessId),
    equipmentRows,
    referenceRows,
    listProducts(businessId, { active: "active" }),
    loadLevyRateBasisPoints(businessId, today),
  ]);

  const equipment: ProfitabilityEquipmentExpense[] = equipmentData
    .filter((row) => row.nature !== "tax_social")
    .map((row) => ({ id: String(row.id), description: String(row.description), purchasedOn: String(row.purchased_on), businessAmountCents: toSafeIntegerAmount(row.business_amount_cents) }));

  const sold = salesData.reduce<{ revenue: bigint; margin: bigint }>((totals, row) => ({
    revenue: totals.revenue + BigInt(toSafeIntegerAmount(row.subtotal_cents)) - BigInt(toSafeIntegerAmount(row.discount_cents)),
    margin: totals.margin + BigInt(toSafeIntegerAmount(row.manufacturing_margin_cents)),
  }), { revenue: BigInt(0), margin: BigInt(0) });

  const priced = products.filter((product) => product.sale_price_cents > 0);
  const catalogPrice = priced.reduce((total, product) => total + BigInt(product.sale_price_cents), BigInt(0));
  const catalogMargin = priced.reduce((total, product) => total + BigInt(product.costing.grossMarginCents), BigInt(0));

  let reference: ProfitabilityMarginReference | null = null;
  if (salesData.length > 0 && sold.revenue > BigInt(0)) reference = { source: "sales", revenueCents: toSafeIntegerAmount(sold.revenue), marginCents: toSafeIntegerAmount(sold.margin), count: salesData.length };
  else if (priced.length > 0) reference = { source: "catalog", revenueCents: toSafeIntegerAmount(catalogPrice), marginCents: toSafeIntegerAmount(catalogMargin), count: priced.length };

  return {
    today,
    equipmentSince,
    charges: templates.map((template) => ({
      id: template.id,
      description: template.description,
      category: template.category,
      nature: template.nature,
      costBehavior: template.cost_behavior,
      estimatedAmountCents: toSafeIntegerAmount(template.estimated_amount_cents),
      professionalShareBasisPoints: toSafeIntegerAmount(template.professional_share_basis_points),
      frequency: template.frequency,
      isActive: template.is_active,
    })),
    equipment,
    reference,
    catalog: { priceTotalCents: toSafeIntegerAmount(catalogPrice), productCount: priced.length },
    levyRateBasisPoints,
  };
}
