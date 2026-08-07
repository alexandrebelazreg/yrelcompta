import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toSafeIntegerAmount } from "@/lib/sales/calculations";
import { saleChannelLabels } from "@/lib/sales/labels";
import { getTodayInParis } from "@/lib/utils/date";
import type { DeclarationPeriod, VatRegime } from "@/types/database";
import type { ExpensePaymentMethod, ExpenseRefundKind } from "@/types/expenses";
import type { PaymentMethod, RefundKind, SaleChannel } from "@/types/sales";
import type {
  CustomerRefundRegisterEntry,
  DeclarationCalculationStatus,
  DeclarationPeriodItem,
  DeclarationSettings,
  DeclarationsPageData,
  PurchaseRegisterEntry,
  RevenueRegisterEntry,
  SupplierRefundRegisterEntry,
  TurnoverDeclaration,
} from "@/types/registers";
import {
  calculateDeclarationSuggestion,
  calculateRegisterTotals,
  declarationUiStatus,
  generateDeclarationPeriods,
  latestDeclaredAnnualTotal,
} from "./calculations";
import { loadAllRegisterPages } from "./pagination";

const FAILURE_CODE = "REGISTER_DATA_LOAD_FAILED";

function logLoadError(code: string | undefined) {
  console.error("Lecture des registres impossible", { code });
}

function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function yearBounds(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year + 1}-01-01` };
}

function normalizeRevenue(value: Record<string, unknown>): RevenueRegisterEntry {
  const sale = relation(value.sales);
  if (!sale) throw new Error(FAILURE_CODE);
  const channel = sale.channel as SaleChannel;
  const customerName = typeof sale.customer_name === "string" && sale.customer_name.trim() ? sale.customer_name.trim() : null;
  return {
    id: String(value.id),
    receivedOn: String(value.received_on),
    origin: customerName ?? saleChannelLabels[channel],
    saleReference: String(sale.reference),
    channel,
    method: value.method as PaymentMethod,
    paymentReference: value.external_reference === null ? null : String(value.external_reference),
    grossAmountCents: toSafeIntegerAmount(value.gross_amount_cents),
    platformFeeCents: toSafeIntegerAmount(value.platform_fee_cents),
    createdAt: String(value.created_at),
  };
}

function normalizeCustomerRefund(value: Record<string, unknown>): CustomerRefundRegisterEntry {
  const sale = relation(value.sales);
  const payment = relation(value.payments);
  if (!sale || !payment) throw new Error(FAILURE_CODE);
  return {
    id: String(value.id),
    refundedOn: String(value.refunded_on),
    saleReference: String(sale.reference),
    paymentReference: payment.external_reference === null ? null : String(payment.external_reference),
    amountCents: toSafeIntegerAmount(value.amount_cents),
    kind: value.kind as RefundKind,
    reason: String(value.reason),
    createdAt: String(value.created_at),
  };
}

function normalizePurchase(value: Record<string, unknown>): PurchaseRegisterEntry {
  const expense = relation(value.expenses);
  if (!expense) throw new Error(FAILURE_CODE);
  return {
    id: String(value.id),
    paidOn: String(value.paid_on),
    expenseReference: String(expense.reference),
    description: String(expense.description),
    method: value.method as ExpensePaymentMethod,
    supplierReference: expense.external_reference === null ? null : String(expense.external_reference),
    paymentReference: value.external_reference === null ? null : String(value.external_reference),
    amountCents: toSafeIntegerAmount(value.amount_cents),
    businessAmountCents: toSafeIntegerAmount(value.business_amount_cents),
    createdAt: String(value.created_at),
  };
}

function normalizeSupplierRefund(value: Record<string, unknown>): SupplierRefundRegisterEntry {
  const expense = relation(value.expenses);
  if (!expense) throw new Error(FAILURE_CODE);
  return {
    id: String(value.id),
    receivedOn: String(value.received_on),
    expenseReference: String(expense.reference),
    amountCents: toSafeIntegerAmount(value.amount_cents),
    kind: value.kind as ExpenseRefundKind,
    reason: String(value.reason),
    externalReference: value.external_reference === null ? null : String(value.external_reference),
    createdAt: String(value.created_at),
  };
}

function normalizeDeclaration(value: Record<string, unknown>): TurnoverDeclaration {
  return {
    id: String(value.id),
    businessId: String(value.business_id),
    periodStart: String(value.period_start),
    periodEnd: String(value.period_end),
    dueOn: String(value.due_on),
    declarationPeriodSnapshot: value.declaration_period_snapshot as DeclarationPeriod,
    vatRegimeSnapshot: value.vat_regime_snapshot as VatRegime,
    revisionNo: toSafeIntegerAmount(value.revision_no),
    previousDeclarationId: value.previous_declaration_id === null ? null : String(value.previous_declaration_id),
    calculationStatus: value.calculation_status as DeclarationCalculationStatus,
    suggestedTurnoverCents: value.suggested_turnover_cents === null ? null : toSafeIntegerAmount(value.suggested_turnover_cents),
    grossReceiptsSnapshotCents: toSafeIntegerAmount(value.gross_receipts_snapshot_cents),
    customerRefundsSnapshotCents: toSafeIntegerAmount(value.customer_refunds_snapshot_cents),
    paymentCountSnapshot: toSafeIntegerAmount(value.payment_count_snapshot),
    refundCountSnapshot: toSafeIntegerAmount(value.refund_count_snapshot),
    declaredTurnoverCents: toSafeIntegerAmount(value.declared_turnover_cents),
    submittedOn: String(value.submitted_on),
    externalReference: value.external_reference === null ? null : String(value.external_reference),
    adjustmentReason: value.adjustment_reason === null ? null : String(value.adjustment_reason),
    createdAt: String(value.created_at),
  };
}

async function registerClient() {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE_CODE);
  return supabase;
}

export async function getRevenueRegister(businessId: string, year: number) {
  const supabase = await registerClient();
  const bounds = yearBounds(year);
  try {
    const [payments, refunds] = await Promise.all([
      loadAllRegisterPages(async (from, to) => {
        const { data, error } = await supabase.from("payments")
          .select("id,received_on,gross_amount_cents,platform_fee_cents,method,external_reference,created_at,sales!payments_sale_business_fk(reference,customer_name,channel)")
          .eq("business_id", businessId).gte("received_on", bounds.start).lt("received_on", bounds.end)
          .order("received_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
        return { data: data as unknown as Array<Record<string, unknown>> | null, error };
      }, logLoadError),
      loadAllRegisterPages(async (from, to) => {
        const { data, error } = await supabase.from("refunds")
          .select("id,refunded_on,amount_cents,kind,reason,created_at,sales!refunds_sale_business_fk(reference),payments!refunds_payment_business_sale_fk(external_reference)")
          .eq("business_id", businessId).gte("refunded_on", bounds.start).lt("refunded_on", bounds.end)
          .order("refunded_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
        return { data: data as unknown as Array<Record<string, unknown>> | null, error };
      }, logLoadError),
    ]);
    const entries = payments.map(normalizeRevenue);
    return { entries, refunds: refunds.map(normalizeCustomerRefund), totals: calculateRegisterTotals(entries, (row) => row.receivedOn, (row) => row.grossAmountCents) };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== FAILURE_CODE) logLoadError(FAILURE_CODE);
    throw new Error(FAILURE_CODE);
  }
}

export async function getPurchaseRegister(businessId: string, year: number) {
  const supabase = await registerClient();
  const bounds = yearBounds(year);
  try {
    const [payments, refunds] = await Promise.all([
      loadAllRegisterPages(async (from, to) => {
        const { data, error } = await supabase.from("expense_payments")
          .select("id,paid_on,amount_cents,business_amount_cents,method,external_reference,created_at,expenses!inner(reference,description,status,external_reference)")
          .eq("business_id", businessId).in("expenses.status", ["validated", "cancelled"])
          .gte("paid_on", bounds.start).lt("paid_on", bounds.end)
          .order("paid_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
        return { data: data as unknown as Array<Record<string, unknown>> | null, error };
      }, logLoadError),
      loadAllRegisterPages(async (from, to) => {
        const { data, error } = await supabase.from("expense_refunds")
          .select("id,received_on,amount_cents,kind,reason,external_reference,created_at,expenses!expense_refunds_expense_fk(reference)")
          .eq("business_id", businessId).gte("received_on", bounds.start).lt("received_on", bounds.end)
          .order("received_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
        return { data: data as unknown as Array<Record<string, unknown>> | null, error };
      }, logLoadError),
    ]);
    const entries = payments.map(normalizePurchase);
    return { entries, refunds: refunds.map(normalizeSupplierRefund), totals: calculateRegisterTotals(entries, (row) => row.paidOn, (row) => row.amountCents) };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== FAILURE_CODE) logLoadError(FAILURE_CODE);
    throw new Error(FAILURE_CODE);
  }
}

async function getSettings(businessId: string): Promise<DeclarationSettings> {
  const supabase = await registerClient();
  const { data, error } = await supabase.from("business_settings")
    .select("activity_started_on,declaration_period,vat_regime")
    .eq("business_id", businessId).maybeSingle();
  if (error || !data) {
    logLoadError(error?.code ?? "SETTINGS_NOT_FOUND");
    throw new Error(FAILURE_CODE);
  }
  return {
    activityStartedOn: data.activity_started_on === null ? null : String(data.activity_started_on),
    declarationPeriod: data.declaration_period as DeclarationPeriod,
    vatRegime: data.vat_regime as VatRegime,
  };
}

async function getDeclarations(businessId: string, year: number): Promise<TurnoverDeclaration[]> {
  const supabase = await registerClient();
  const bounds = yearBounds(year);
  const rows = await loadAllRegisterPages(async (from, to) => {
    const { data, error } = await supabase.from("turnover_declarations")
      .select("id,business_id,period_start,period_end,due_on,declaration_period_snapshot,vat_regime_snapshot,revision_no,previous_declaration_id,calculation_status,suggested_turnover_cents,gross_receipts_snapshot_cents,customer_refunds_snapshot_cents,payment_count_snapshot,refund_count_snapshot,declared_turnover_cents,submitted_on,external_reference,adjustment_reason,created_at")
      .eq("business_id", businessId).gte("period_end", bounds.start).lt("period_end", bounds.end)
      .order("period_start", { ascending: true }).order("revision_no", { ascending: true }).order("id", { ascending: true }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logLoadError);
  return rows.map(normalizeDeclaration);
}

async function loadDeclarationFlows(businessId: string, start: string, endInclusive: string) {
  const supabase = await registerClient();
  const [payments, refunds] = await Promise.all([
    loadAllRegisterPages(async (from, to) => {
      const { data, error } = await supabase.from("payments").select("received_on,gross_amount_cents,platform_fee_cents")
        .eq("business_id", businessId).gte("received_on", start).lte("received_on", endInclusive)
        .order("received_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
      return { data: data as unknown as Array<Record<string, unknown>> | null, error };
    }, logLoadError),
    loadAllRegisterPages(async (from, to) => {
      const { data, error } = await supabase.from("refunds").select("refunded_on,amount_cents")
        .eq("business_id", businessId).gte("refunded_on", start).lte("refunded_on", endInclusive)
        .order("refunded_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
      return { data: data as unknown as Array<Record<string, unknown>> | null, error };
    }, logLoadError),
  ]);
  return {
    payments: payments.map((row) => ({
      receivedOn: String(row.received_on),
      grossAmountCents: toSafeIntegerAmount(row.gross_amount_cents),
      platformFeeCents: toSafeIntegerAmount(row.platform_fee_cents),
    })),
    refunds: refunds.map((row) => ({ refundedOn: String(row.refunded_on), amountCents: toSafeIntegerAmount(row.amount_cents) })),
  };
}

export async function getDeclarationsPageData(businessId: string, year: number, now = new Date()): Promise<DeclarationsPageData> {
  try {
    const [settings, declarations] = await Promise.all([getSettings(businessId), getDeclarations(businessId, year)]);
    const generated = generateDeclarationPeriods(settings.activityStartedOn, settings.declarationPeriod, year);
    const annualStart = `${year}-01-01`;
    const annualLastDay = `${year}-12-31`;
    const flowStart = generated.length > 0 && generated[0].periodStart < annualStart ? generated[0].periodStart : annualStart;
    const flowEnd = generated.length > 0 && generated[generated.length - 1].periodEnd > annualLastDay
      ? generated[generated.length - 1].periodEnd
      : annualLastDay;
    const flows = settings.activityStartedOn === null
      ? { payments: [], refunds: [] }
      : await loadDeclarationFlows(businessId, flowStart, flowEnd);
    const today = getTodayInParis(now);
    const periods: DeclarationPeriodItem[] = generated.map((period) => {
      const periodPayments = flows.payments.filter((payment) => payment.receivedOn >= period.periodStart && payment.receivedOn <= period.periodEnd);
      const periodRefunds = flows.refunds.filter((refund) => refund.refundedOn >= period.periodStart && refund.refundedOn <= period.periodEnd);
      const suggestion = calculateDeclarationSuggestion(settings.vatRegime, periodPayments, periodRefunds);
      const revisions = declarations.filter((declaration) => declaration.periodStart === period.periodStart && declaration.periodEnd === period.periodEnd);
      const latestDeclaration = revisions.reduce<TurnoverDeclaration | null>(
        (latest, declaration) => !latest || declaration.revisionNo > latest.revisionNo ? declaration : latest,
        null,
      );
      return {
        ...period,
        uiStatus: declarationUiStatus(period.periodEnd, period.dueOn, latestDeclaration !== null, today),
        grossReceiptsCents: suggestion.grossReceiptsCents,
        customerRefundsCents: suggestion.customerRefundsCents,
        paymentCount: suggestion.paymentCount,
        refundCount: suggestion.refundCount,
        calculationStatus: suggestion.calculationStatus,
        suggestedTurnoverCents: suggestion.suggestedTurnoverCents,
        latestDeclaration,
        revisions,
      };
    });
    const annualEnd = `${year + 1}-01-01`;
    const annualSuggestion = calculateDeclarationSuggestion(
      settings.vatRegime,
      flows.payments.filter((payment) => payment.receivedOn >= annualStart && payment.receivedOn < annualEnd),
      flows.refunds.filter((refund) => refund.refundedOn >= annualStart && refund.refundedOn < annualEnd),
    );
    return {
      settings,
      periods,
      annualGrossReceiptsCents: annualSuggestion.grossReceiptsCents,
      annualCustomerRefundsCents: annualSuggestion.customerRefundsCents,
      annualDeclaredCents: latestDeclaredAnnualTotal(declarations),
    };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== FAILURE_CODE) logLoadError(FAILURE_CODE);
    throw new Error(FAILURE_CODE);
  }
}
