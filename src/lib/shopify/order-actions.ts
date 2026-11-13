"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTodayInParis } from "@/lib/utils/date";
import { shopifyErrorMessage } from "./errors";
import { importShopifyHistory, syncRecentShopifyOrders, syncShopifyOrder } from "./order-sync";
import { getShopifySyncStatus, isShopifySyncStale } from "./order-queries";
import { getShopifyConnectionStatus } from "./queries";

const PAGE = "/ventes/shopify";
const uuid = z.string().uuid();

function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  revalidatePath("/ventes");
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

async function context() {
  const { userId, context: app } = await getAuthenticatedContext();
  if (!userId || !app.business) back({ erreur: "Session indisponible. Reconnectez-vous." });
  return { userId, businessId: app.business.id };
}

async function connectionId(businessId: string) {
  const status = await getShopifyConnectionStatus(businessId);
  if (!status) back({ erreur: "Shopify n’est pas connecté." });
  return status.id;
}

export async function importShopifyHistoryAction(formData: FormData) {
  const { userId, businessId } = await context();
  const since = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(formData.get("since"));
  if (!since.success || since.data > getTodayInParis()) back({ erreur: "Choisissez une date de début valide." });
  const connection = await connectionId(businessId);
  let result: { imported: number; failed: number };
  try {
    result = await importShopifyHistory({ connectionId: connection, actor: userId, since: since.data });
  } catch (error) {
    back({ erreur: shopifyErrorMessage(error) });
  }
  back({ message: "historique", importees: String(result.imported), echecs: String(result.failed) });
}

export async function linkShopifyProductAction(formData: FormData) {
  const { businessId } = await context();
  const parsed = z.object({
    productId: uuid,
    shopifyProductGid: z.string().regex(/^gid:\/\/shopify\/Product\/[0-9]+$/),
    shopifyVariantGid: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[0-9]+$/).or(z.literal("")),
    title: z.string().trim().min(1).max(300),
    sku: z.string().trim().max(100),
  }).safeParse(Object.fromEntries(["productId", "shopifyProductGid", "shopifyVariantGid", "title", "sku"].map((key) => [key, formData.get(key) ?? ""])));
  if (!parsed.success) back({ erreur: "Choisissez le produit YrelCompta à relier." });
  const supabase = await createClient();
  if (!supabase) back({ erreur: "Supabase n’est pas configuré." });
  const p = parsed.data;
  const { data, error } = await supabase.rpc("link_shopify_product", { p_business_id: businessId, p_shopify_product_gid: p.shopifyProductGid, p_shopify_variant_gid: p.shopifyVariantGid || null, p_shopify_title: p.title, p_shopify_sku: p.sku || null, p_product_id: p.productId });
  if (error) {
    console.error("Liaison de produit Shopify refusée", { code: error.code });
    back({ erreur: "La liaison a été refusée : vérifiez que le produit est actif." });
  }
  back({ message: "relie", relancees: String(data ?? 0) });
}

export async function reprocessShopifyImportAction(formData: FormData) {
  const { businessId } = await context();
  const id = uuid.safeParse(formData.get("importId"));
  if (!id.success) back({ erreur: "Commande invalide." });
  const supabase = await createClient();
  if (!supabase) back({ erreur: "Supabase n’est pas configuré." });
  const { error } = await supabase.rpc("reprocess_shopify_order_import", { p_import_id: id.data, p_business_id: businessId });
  if (error) {
    console.error("Relance d’import Shopify refusée", { code: error.code });
    back({ erreur: "La commande n’a pas pu être relancée." });
  }
  back({ message: "relancee" });
}

export async function dismissShopifyAttentionAction(formData: FormData) {
  const { businessId } = await context();
  const id = uuid.safeParse(formData.get("importId"));
  const flag = z.enum(["refund_to_record", "order_cancelled"]).safeParse(formData.get("flag"));
  if (!id.success || !flag.success) back({ erreur: "Signalement invalide." });
  const supabase = await createClient();
  if (!supabase) back({ erreur: "Supabase n’est pas configuré." });
  const { error } = await supabase.rpc("dismiss_shopify_import_attention", { p_import_id: id.data, p_business_id: businessId, p_flag: flag.data });
  if (error) back({ erreur: "Le signalement n’a pas pu être marqué comme traité." });
  back({ message: "traite" });
}

/** Relance l'import des commandes dont la notification Shopify a échoué. */
export async function retryFailedShopifyEventsAction() {
  const { userId, businessId } = await context();
  const connection = await connectionId(businessId);
  const admin = createAdminClient();
  const { data, error } = await admin.from("shopify_webhook_events").select("webhook_id,shopify_order_gid")
    .eq("business_id", businessId).eq("connection_id", connection).eq("processing_status", "error").limit(100);
  if (error) back({ erreur: "Les notifications en erreur n’ont pas pu être lues." });
  const orderGids = [...new Set((data ?? []).map((event) => event.shopify_order_gid).filter((gid): gid is string => Boolean(gid)))];
  let succeeded = 0;
  for (const orderGid of orderGids) {
    try {
      await syncShopifyOrder({ connectionId: connection, orderGid, actor: userId });
      succeeded++;
      for (const event of (data ?? []).filter((row) => row.shopify_order_gid === orderGid)) {
        await admin.rpc("mark_shopify_webhook_event", { p_connection_id: connection, p_webhook_id: event.webhook_id, p_status: "processed", p_error_code: null });
      }
    } catch {
      // L'événement reste en erreur pour une prochaine relance.
    }
  }
  back({ message: "relance-notifications", reussies: String(succeeded), total: String(orderGids.length) });
}

/** Bouton « Synchroniser maintenant » : relit les commandes récentes chez Shopify. */
export async function syncShopifyNowAction() {
  const { userId, businessId } = await context();
  const connection = await connectionId(businessId);
  const sync = await getShopifySyncStatus(businessId);
  const result = await syncRecentShopifyOrders({ connectionId: connection, syncedThrough: sync?.ordersSyncedThrough ?? null, actor: userId });
  if (result.errorCode && result.imported === 0 && result.failed === 0) back({ erreur: "Shopify n’a pas répondu. Réessayez dans quelques minutes." });
  back({ message: "synchronise", importees: String(result.imported), echecs: String(result.failed) });
}

/** Synchronisation à l'ouverture de la page, seulement si la dernière date de plus de 15 minutes. */
export async function autoSyncShopifyAction(): Promise<{ synced: boolean }> {
  const { userId, context: app } = await getAuthenticatedContext();
  if (!userId || !app.business) return { synced: false };
  const status = await getShopifyConnectionStatus(app.business.id);
  if (!status) return { synced: false };
  const sync = await getShopifySyncStatus(app.business.id);
  if (!isShopifySyncStale(sync)) return { synced: false };
  await syncRecentShopifyOrders({ connectionId: status.id, syncedThrough: sync?.ordersSyncedThrough ?? null, actor: userId });
  revalidatePath(PAGE);
  return { synced: true };
}
