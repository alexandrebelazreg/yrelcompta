import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toSafeIntegerAmount } from "@/lib/sales/calculations";
import type {
  DashboardExpenseFlow,
  DashboardMissingDocument,
  DashboardMonth,
  DashboardPayment,
  DashboardRecentSale,
  DashboardRecurringTemplate,
  DashboardRefund,
  DashboardSaleCosting,
  DashboardSourceData,
} from "@/types/dashboard";
import type { ExpenseCategory, ExpenseCostBehavior, ExpenseNature, RecurrenceFrequency } from "@/types/expenses";
import type { SaleChannel } from "@/types/sales";
import type { SaleStatus } from "@/types/sales";
import { loadAllDashboardPages } from "./pagination";
import { previousIsoDate } from "@/lib/fiscal-social/calculations";
import { getFiscalCalculationContext } from "@/lib/fiscal-social/queries";

const FAILURE_CODE = "DASHBOARD_DATA_LOAD_FAILED";

function logLoadError(code: string | undefined) {
  console.error("Lecture du tableau de bord impossible", { code });
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(FAILURE_CODE);
  return value;
}

function nullableAmount(value: unknown): number | null {
  return value === null || value === undefined ? null : toSafeIntegerAmount(value);
}

function normalizeSale(value: unknown): DashboardSaleCosting {
  const sale = value as Record<string, unknown>;
  return {
    status: sale.status as SaleStatus,
    subtotalCents: toSafeIntegerAmount(sale.subtotal_cents),
    shippingCents: toSafeIntegerAmount(sale.shipping_cents),
    discountCents: toSafeIntegerAmount(sale.discount_cents),
    manufacturingCostCents: nullableAmount(sale.manufacturing_cost_cents),
    manufacturingMarginCents: nullableAmount(sale.manufacturing_margin_cents),
    costingComplete: booleanValue(sale.costing_complete),
    costingEvaluated: booleanValue(sale.costing_evaluated),
  };
}

async function loadData(businessId: string, month: DashboardMonth): Promise<DashboardSourceData> {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE_CODE);

  const payments = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("payments")
      .select("gross_amount_cents,platform_fee_cents")
      .eq("business_id", businessId).gte("received_on", month.start).lt("received_on", month.end)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows): DashboardPayment[] => rows.map((row) => ({
    grossAmountCents: toSafeIntegerAmount(row.gross_amount_cents),
    platformFeeCents: toSafeIntegerAmount(row.platform_fee_cents),
  })));

  const customerRefunds = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("refunds").select("amount_cents")
      .eq("business_id", businessId).gte("refunded_on", month.start).lt("refunded_on", month.end)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows): DashboardRefund[] => rows.map((row) => ({
    amountCents: toSafeIntegerAmount(row.amount_cents),
  })));

  const expensePayments = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("expense_payments").select("business_amount_cents")
      .eq("business_id", businessId).gte("paid_on", month.start).lt("paid_on", month.end)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows): DashboardExpenseFlow[] => rows.map((row) => ({
    businessAmountCents: toSafeIntegerAmount(row.business_amount_cents),
  })));

  const expenseRefunds = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("expense_refunds").select("business_amount_cents")
      .eq("business_id", businessId).gte("received_on", month.start).lt("received_on", month.end)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows): DashboardExpenseFlow[] => rows.map((row) => ({
    businessAmountCents: toSafeIntegerAmount(row.business_amount_cents),
  })));

  const monthlySales = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("sales")
      .select("status,subtotal_cents,shipping_cents,discount_cents,manufacturing_cost_cents,manufacturing_margin_cents,costing_complete,costing_evaluated")
      .eq("business_id", businessId).eq("status", "validated")
      .gte("ordered_on", month.start).lt("ordered_on", month.end)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows) => rows.map(normalizeSale));

  const referenceSales = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("sales")
      .select("status,subtotal_cents,shipping_cents,discount_cents,manufacturing_cost_cents,manufacturing_margin_cents,costing_complete,costing_evaluated")
      .eq("business_id", businessId).eq("status", "validated")
      .eq("costing_complete", true).eq("costing_evaluated", true)
      .gte("ordered_on", month.referenceStart).lt("ordered_on", month.end)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows) => rows.map(normalizeSale));

  const recurringTemplates = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("recurring_expense_templates")
      .select("category,nature,cost_behavior,estimated_amount_cents,professional_share_basis_points,frequency,is_active")
      .eq("business_id", businessId)
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows): DashboardRecurringTemplate[] => rows.map((row) => ({
    category: row.category as ExpenseCategory,
    nature: row.nature as ExpenseNature,
    costBehavior: row.cost_behavior as ExpenseCostBehavior,
    estimatedAmountCents: toSafeIntegerAmount(row.estimated_amount_cents),
    professionalShareBasisPoints: toSafeIntegerAmount(row.professional_share_basis_points),
    frequency: row.frequency as RecurrenceFrequency,
    isActive: booleanValue(row.is_active),
  })));

  const missingDocuments = loadAllDashboardPages(async (from, to) => {
    const { data, error } = await supabase.from("expenses").select("expense_documents(count)")
      .eq("business_id", businessId).eq("status", "validated")
      .order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError).then((rows): DashboardMissingDocument[] => rows.map((row) => {
    const counts = row.expense_documents as Array<{ count?: unknown }> | null;
    return { documentCount: toSafeIntegerAmount(counts?.[0]?.count ?? 0) };
  }));

  const recentSales = (async (): Promise<DashboardRecentSale[]> => {
    const { data, error } = await supabase.from("sales").select("id,reference,ordered_on,channel,total_cents")
      .eq("business_id", businessId)
      .order("ordered_on", { ascending: false }).order("id", { ascending: true }).limit(5);
    if (error) {
      logLoadError(error.code);
      throw new Error(FAILURE_CODE);
    }
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      reference: String(row.reference),
      orderedOn: String(row.ordered_on),
      channel: row.channel as SaleChannel,
      totalCents: toSafeIntegerAmount(row.total_cents),
    }));
  })();

  const fiscalCalculationDate = previousIsoDate(month.end);
  const fiscalContext = getFiscalCalculationContext(businessId, fiscalCalculationDate);

  const [
    loadedPayments,
    loadedCustomerRefunds,
    loadedExpensePayments,
    loadedExpenseRefunds,
    loadedMonthlySales,
    loadedReferenceSales,
    loadedRecurringTemplates,
    loadedMissingDocuments,
    loadedRecentSales,
    loadedFiscalContext,
  ] = await Promise.all([
    payments,
    customerRefunds,
    expensePayments,
    expenseRefunds,
    monthlySales,
    referenceSales,
    recurringTemplates,
    missingDocuments,
    recentSales,
    fiscalContext,
  ]);

  return {
    payments: loadedPayments,
    customerRefunds: loadedCustomerRefunds,
    expensePayments: loadedExpensePayments,
    expenseRefunds: loadedExpenseRefunds,
    monthlySales: loadedMonthlySales,
    referenceSales: loadedReferenceSales,
    recurringTemplates: loadedRecurringTemplates,
    missingDocuments: loadedMissingDocuments,
    recentSales: loadedRecentSales,
    fiscalCalculationDate,
    fiscalContext: loadedFiscalContext,
  };
}

export async function getDashboardData(businessId: string, month: DashboardMonth): Promise<DashboardSourceData> {
  try {
    return await loadData(businessId, month);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== FAILURE_CODE) logLoadError(FAILURE_CODE);
    throw new Error(FAILURE_CODE);
  }
}
