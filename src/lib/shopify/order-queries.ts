import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ShopifyImportStatus = "validated" | "draft_incomplete" | "waiting_payment" | "needs_review" | "cancelled" | "ignored";

export interface ShopifyUnlinkedItem { title: string; sku: string | null; product_gid: string | null; variant_gid: string | null }

export interface ShopifyOrderImport {
  id: string;
  order_name: string;
  ordered_on: string;
  total_cents: number;
  status: ShopifyImportStatus;
  attention: string[];
  unlinked_items: ShopifyUnlinkedItem[];
  sale_id: string | null;
  sales: { reference: string; status: string } | null;
}

export interface ShopifyProductToLink extends ShopifyUnlinkedItem { orderCount: number }

export async function listShopifyOrderImports(businessId: string): Promise<ShopifyOrderImport[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.from("shopify_order_imports")
    .select("id,order_name,ordered_on,total_cents,status,attention,unlinked_items,sale_id,sales(reference,status)")
    .eq("business_id", businessId).order("ordered_on", { ascending: false }).order("order_name", { ascending: false }).limit(200);
  if (error) {
    console.error("Lecture des commandes Shopify impossible", { code: error.code });
    return [];
  }
  return (data ?? []).map((row) => {
    const sale = row.sales as unknown as ShopifyOrderImport["sales"] | ShopifyOrderImport["sales"][];
    return { ...row, total_cents: Number(row.total_cents), sales: Array.isArray(sale) ? sale[0] ?? null : sale } as ShopifyOrderImport;
  });
}

/** Produits Shopify sans correspondance dans l'application, regroupés (variante, sinon produit). */
export function productsToLink(imports: ShopifyOrderImport[]): ShopifyProductToLink[] {
  const byKey = new Map<string, ShopifyProductToLink>();
  for (const item of imports.filter((entry) => entry.status === "draft_incomplete").flatMap((entry) => entry.unlinked_items)) {
    if (!item.product_gid) continue;
    const key = item.variant_gid ?? item.product_gid;
    const current = byKey.get(key);
    if (current) current.orderCount += 1;
    else byKey.set(key, { ...item, orderCount: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.orderCount - a.orderCount || a.title.localeCompare(b.title, "fr"));
}

/** Notifications Shopify dont l'import a échoué (lues côté serveur, limitées à l'entreprise). */
export async function countFailedShopifyEvents(businessId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin.from("shopify_webhook_events").select("id", { count: "exact", head: true })
      .eq("business_id", businessId).eq("processing_status", "error");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
