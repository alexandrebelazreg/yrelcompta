import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MaterialPurchase } from "./purchases";

const columns = "id,material_id,purchased_on,supplier_id,suppliers(name),order_reference,quantity_milliunits,total_cost_cents,expense_id,expenses(reference),excluded,source,created_at";

/** Achats des matières de l'entreprise (d'une seule matière si précisée), du plus récent au plus ancien. */
export async function listMaterialPurchases(businessId: string, materialId?: string): Promise<MaterialPurchase[]> {
  const supabase = await createClient();
  if (!supabase) throw new Error("PRODUCT_DATA_LOAD_FAILED");
  const rows: MaterialPurchase[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from("material_purchases").select(columns).eq("business_id", businessId);
    if (materialId) query = query.eq("material_id", materialId);
    const { data, error } = await query.order("purchased_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(from, from + 999);
    if (error) {
      console.error("Lecture de l’historique d’achats impossible", { code: error.code });
      throw new Error("PRODUCT_DATA_LOAD_FAILED");
    }
    rows.push(...(data as unknown as MaterialPurchase[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** Regroupe les achats par matière. */
export function groupPurchasesByMaterial(purchases: MaterialPurchase[]): Map<string, MaterialPurchase[]> {
  const grouped = new Map<string, MaterialPurchase[]>();
  for (const purchase of purchases) grouped.set(purchase.material_id, [...(grouped.get(purchase.material_id) ?? []), purchase]);
  return grouped;
}
