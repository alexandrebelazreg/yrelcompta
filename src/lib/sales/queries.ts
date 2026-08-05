import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Sale, SaleChannel, SaleStatus } from "@/types/sales";
import { calculateSalesTotals, type SalesTotalsSource } from "./calculations";

const saleSelect = `id,business_id,reference,ordered_on,channel,customer_name,notes,status,subtotal_cents,shipping_cents,discount_cents,total_cents,validated_at,cancelled_at,cancellation_reason,
sale_items(id,description,quantity,unit_price_cents,line_total_cents,position),
payments(id,received_on,bank_deposited_on,gross_amount_cents,platform_fee_cents,net_deposit_cents,method,external_reference,notes,refunds(id,payment_id,refunded_on,amount_cents,kind,reason))`;

function normalizeSale(value: unknown): Sale {
  const sale = value as Sale;
  return { ...sale, sale_items: [...(sale.sale_items ?? [])].sort((a, b) => a.position - b.position), payments: sale.payments ?? [] };
}

export interface SaleFilters { status?: SaleStatus; channel?: SaleChannel; search?: string; }

export async function listSales(businessId: string, filters: SaleFilters = {}): Promise<Sale[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  let query = supabase.from("sales").select(saleSelect).eq("business_id", businessId).order("ordered_on", { ascending: false }).limit(100);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.search) {
    const safeSearch = filters.search.trim().replace(/[%_,()]/g, "").slice(0, 80);
    if (safeSearch) query = query.or(`reference.ilike.%${safeSearch}%,customer_name.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) { console.error("Lecture des ventes impossible", { code: error.code }); return []; }
  return (data ?? []).map(normalizeSale);
}

export async function getSale(businessId: string, saleId: string): Promise<Sale | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("sales").select(saleSelect).eq("business_id", businessId).eq("id", saleId).maybeSingle();
  if (error) console.error("Lecture de la vente impossible", { code: error.code });
  return data ? normalizeSale(data) : null;
}

export async function getSalesOverview(businessId: string) {
  const [sales, totals] = await Promise.all([listSales(businessId), getGlobalSalesTotals(businessId)]);
  return { sales, totals };
}

const aggregationPageSize = 1000;

async function getGlobalSalesTotals(businessId: string) {
  const supabase = await createClient();
  if (!supabase) return calculateSalesTotals([]);

  const sales: SalesTotalsSource[] = [];
  for (let from = 0; ; from += aggregationPageSize) {
    const { data, error } = await supabase
      .from("sales")
      .select("status,total_cents,payments(gross_amount_cents,platform_fee_cents,refunds(amount_cents))")
      .eq("business_id", businessId)
      .order("id", { ascending: true })
      .range(from, from + aggregationPageSize - 1);
    if (error) {
      console.error("Calcul global des ventes impossible", { code: error.code });
      throw new Error("SALES_AGGREGATION_FAILED");
    }
    const page = (data ?? []) as unknown as SalesTotalsSource[];
    sales.push(...page);
    if (page.length < aggregationPageSize) break;
  }

  return calculateSalesTotals(sales);
}

function parisMonthBounds(date = new Date()): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` };
}

export async function getDashboardSales(businessId: string) {
  const bounds = parisMonthBounds();
  const supabase = await createClient();
  const sales = await listSales(businessId);
  if (!supabase) return { monthlyRevenueCents: 0, recentSales: sales.slice(0, 5), hasSales: sales.length > 0 };
  const [paymentsResult, refundsResult] = await Promise.all([
    supabase.from("payments").select("gross_amount_cents").eq("business_id", businessId).gte("received_on", bounds.start).lt("received_on", bounds.end),
    supabase.from("refunds").select("amount_cents").eq("business_id", businessId).gte("refunded_on", bounds.start).lt("refunded_on", bounds.end),
  ]);
  if (paymentsResult.error) console.error("Calcul mensuel des encaissements impossible", { code: paymentsResult.error.code });
  if (refundsResult.error) console.error("Calcul mensuel des remboursements impossible", { code: refundsResult.error.code });
  const gross = (paymentsResult.data ?? []).reduce((sum, payment) => sum + payment.gross_amount_cents, 0);
  const refunded = (refundsResult.data ?? []).reduce((sum, refund) => sum + refund.amount_cents, 0);
  return { monthlyRevenueCents: gross - refunded, recentSales: sales.slice(0, 5), hasSales: sales.length > 0 };
}
