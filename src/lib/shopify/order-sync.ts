import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyGraphql, shopifyGraphqlPartial } from "./client";
import { ShopifyError } from "./errors";
import { customerNameFrom, normalizeShopifyOrder, SHOPIFY_ORDER_CUSTOMER_QUERY, SHOPIFY_ORDER_QUERY, SHOPIFY_ORDERS_QUERY, SHOPIFY_RECENT_ORDERS_QUERY, shopifyHistoryQuery, shopifyRecentQuery, shopifySyncedThrough, shopifySyncSince, type ShopifyOrderNode } from "./orders";
import { getShopifyAccessToken } from "./token-manager";

/** Nombre maximal de commandes importées en une fois depuis l'historique. */
export const SHOPIFY_HISTORY_LIMIT = 500;

async function importNode(connectionId: string, actor: string | null, node: ShopifyOrderNode, access: { shopDomain: string; accessToken: string }) {
  const order = normalizeShopifyOrder(node);
  const customer = await shopifyGraphqlPartial<{ order?: { billingAddress?: { firstName?: string | null; lastName?: string | null } | null } | null }>({
    ...access, query: SHOPIFY_ORDER_CUSTOMER_QUERY, variables: { id: order.gid },
  });
  const admin = createAdminClient();
  const { error } = await admin.rpc("shopify_import_order", { p_connection_id: connectionId, p_actor: actor, p_order: order, p_customer_name: customerNameFrom(customer.data) });
  if (error) {
    console.error("Import de commande Shopify refusé", { code: error.code, connection_id: connectionId });
    throw new ShopifyError("SHOPIFY_RESPONSE_INVALID");
  }
}

/** Relit une commande chez Shopify et l'importe (création, mise à jour du brouillon ou signalement). */
export async function syncShopifyOrder({ connectionId, orderGid, actor = null }: { connectionId: string; orderGid: string; actor?: string | null }) {
  const { accessToken, credentials } = await getShopifyAccessToken(connectionId);
  const access = { shopDomain: credentials.shop_domain, accessToken };
  const data = await shopifyGraphql<{ order: ShopifyOrderNode | null }>({ ...access, query: SHOPIFY_ORDER_QUERY, variables: { id: orderGid } });
  if (!data.order) throw new ShopifyError("SHOPIFY_SHOP_NOT_FOUND");
  await importNode(connectionId, actor, data.order, access);
}

/** Importe les commandes payées depuis une date. Shopify limite l'accès aux 60 derniers jours sans permission read_all_orders. */
export async function importShopifyHistory({ connectionId, actor, since }: { connectionId: string; actor: string; since: string }) {
  const { accessToken, credentials } = await getShopifyAccessToken(connectionId);
  const access = { shopDomain: credentials.shop_domain, accessToken };
  let after: string | null = null;
  let imported = 0;
  let failed = 0;
  do {
    const page: { orders: { nodes: ShopifyOrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraphql({ ...access, query: SHOPIFY_ORDERS_QUERY, variables: { query: shopifyHistoryQuery(since), after } });
    for (const node of page.orders.nodes) {
      if (imported + failed >= SHOPIFY_HISTORY_LIMIT) break;
      try {
        await importNode(connectionId, actor, node, access);
        imported++;
      } catch {
        failed++;
      }
    }
    after = page.orders.pageInfo.hasNextPage && imported + failed < SHOPIFY_HISTORY_LIMIT ? page.orders.pageInfo.endCursor : null;
  } while (after);
  return { imported, failed };
}

/** Traite un webhook de commande déjà enregistré, puis note le résultat sur l'événement. */
export async function processShopifyOrderWebhook({ connectionId, webhookId, orderGid }: { connectionId: string; webhookId: string; orderGid: string | null }) {
  const admin = createAdminClient();
  let status: "processed" | "ignored" | "error" = "processed";
  let errorCode: string | null = null;
  if (!orderGid) status = "ignored";
  else {
    try {
      await syncShopifyOrder({ connectionId, orderGid });
    } catch (error) {
      status = "error";
      errorCode = error instanceof ShopifyError ? error.code : "SHOPIFY_ORDER_IMPORT_FAILED";
    }
  }
  const { error } = await admin.rpc("mark_shopify_webhook_event", { p_connection_id: connectionId, p_webhook_id: webhookId, p_status: status, p_error_code: errorCode });
  if (error) console.error("Statut du webhook Shopify non enregistré", { code: error.code });
  return status;
}

/** Nombre maximal de commandes relues par passage ; la suite est reprise au passage suivant. */
export const SHOPIFY_SYNC_BATCH_LIMIT = 150;

/**
 * Relit chez Shopify les commandes créées ou modifiées depuis la dernière synchronisation et les importe.
 * Remplace les webhooks lorsque Shopify ne les accorde pas (offre Basic) ; sans effet de doublon sinon.
 */
export async function syncRecentShopifyOrders({ connectionId, syncedThrough, actor = null, deadline = Date.now() + 7_000 }: { connectionId: string; syncedThrough: string | null; actor?: string | null; deadline?: number }) {
  const admin = createAdminClient();
  const results: Array<{ updatedAt: string | undefined; ok: boolean }> = [];
  let errorCode: string | null = null;
  try {
    const { accessToken, credentials } = await getShopifyAccessToken(connectionId);
    const access = { shopDomain: credentials.shop_domain, accessToken };
    const query = shopifyRecentQuery(shopifySyncSince(syncedThrough));
    let after: string | null = null;
    do {
      const page: { orders: { nodes: ShopifyOrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraphql({ ...access, query: SHOPIFY_RECENT_ORDERS_QUERY, variables: { query, after } });
      for (const node of page.orders.nodes) {
        // Limite de temps de la plateforme : on s'arrête proprement, la suite est reprise au passage suivant.
        if (results.length >= SHOPIFY_SYNC_BATCH_LIMIT || Date.now() > deadline) break;
        try {
          await importNode(connectionId, actor, node, access);
          results.push({ updatedAt: node.updatedAt, ok: true });
        } catch {
          results.push({ updatedAt: node.updatedAt, ok: false });
        }
      }
      after = page.orders.pageInfo.hasNextPage && results.length < SHOPIFY_SYNC_BATCH_LIMIT && Date.now() <= deadline ? page.orders.pageInfo.endCursor : null;
    } while (after);
    if (results.some((result) => !result.ok)) errorCode = "SHOPIFY_ORDER_IMPORT_FAILED";
  } catch (error) {
    errorCode = error instanceof ShopifyError ? error.code : "SHOPIFY_SYNC_FAILED";
  }
  const { error } = await admin.rpc("mark_shopify_orders_synced", { p_connection_id: connectionId, p_synced_through: shopifySyncedThrough(results), p_error_code: errorCode });
  if (error) console.error("État de synchronisation Shopify non enregistré", { code: error.code });
  return { imported: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, errorCode };
}

/** Synchronise toutes les connexions (tâche planifiée), dans la limite d'un budget de temps. */
export async function syncAllShopifyConnections({ budgetMs = 7_000 }: { budgetMs?: number } = {}) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_shopify_sync_connections");
  if (error) throw new ShopifyError("SHOPIFY_UNAVAILABLE");
  const summary: Array<{ imported: number; failed: number; errorCode: string | null }> = [];
  for (const row of (data ?? []) as Array<{ connection_id: string; orders_synced_through: string | null }>) {
    if (Date.now() - started > budgetMs) break;
    summary.push(await syncRecentShopifyOrders({ connectionId: row.connection_id, syncedThrough: row.orders_synced_through, deadline }));
  }
  return summary;
}
