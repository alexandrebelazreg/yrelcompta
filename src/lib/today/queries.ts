import "server-only";
import { createClient } from "@/lib/supabase/server";

const FAILURE_CODE = "TODAY_DATA_LOAD_FAILED";

/** Compteurs de brouillons pour la liste « À faire », toujours filtrés par entreprise (RLS en plus). */
export async function getTodayDraftCounts(businessId: string): Promise<{ draftSaleCount: number; draftExpenseCount: number }> {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE_CODE);
  const [sales, expenses] = await Promise.all([
    supabase.from("sales").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "draft"),
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "draft").is("recurring_template_id", null),
  ]);
  if (sales.error || expenses.error) {
    console.error("Lecture des brouillons impossible", { code: sales.error?.code ?? expenses.error?.code });
    throw new Error(FAILURE_CODE);
  }
  return { draftSaleCount: sales.count ?? 0, draftExpenseCount: expenses.count ?? 0 };
}
