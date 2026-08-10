"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestShopifyToken } from "./auth";
import { fetchShopifyShop } from "./client";
import { normalizeShopDomain } from "./domain";
import { ShopifyError, shopifyErrorCode, shopifyErrorMessage } from "./errors";
import { getShopifyConnectionStatus } from "./queries";
import { getShopifyWebhookUrl } from "./site-url";
import { getShopifyAccessToken } from "./token-manager";
import { deleteYrelComptaWebhooks, reconcileShopifyWebhooks } from "./webhooks";

const connectionSchema = z.object({
  shopDomain: z.string().trim().min(1).max(255),
  clientId: z.string().trim().min(8).max(200),
  clientSecret: z.string().min(8).max(255),
});

async function actionContext() {
  const { userId, context } = await getAuthenticatedContext();
  if (!userId || !context.business) return null;
  return { userId, businessId: context.business.id };
}

async function markShopifyWebhooksPartial(
  context: { userId: string; businessId: string },
  connectionId: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("mark_shopify_webhooks_partial", {
      p_connection_id: connectionId,
      p_business_id: context.businessId,
      p_actor: context.userId,
      p_error_code: "SHOPIFY_WEBHOOKS_PARTIAL",
    });
    if (error) {
      console.error("Statut partiel Shopify non enregistré", {
        code: error.code,
        business_id: context.businessId,
        connection_id: connectionId,
      });
    }
  } catch {
    console.error("Statut partiel Shopify non enregistré", {
      code: "SHOPIFY_PARTIAL_STATUS_UNAVAILABLE",
      business_id: context.businessId,
      connection_id: connectionId,
    });
  }
}

function errorRedirect(error: unknown, context: { businessId?: string; connectionId?: string; shopDomain?: string } = {}): never {
  console.error("Action Shopify refusée", {
    code: shopifyErrorCode(error),
    business_id: context.businessId,
    connection_id: context.connectionId,
    shop_domain: context.shopDomain,
    http_status: error instanceof ShopifyError ? error.httpStatus : undefined,
  });
  redirect(`/parametres/shopify?erreur=${encodeURIComponent(shopifyErrorMessage(error))}`);
}

export async function connectShopifyAction(formData: FormData) {
  const context = await actionContext();
  if (!context) redirect("/parametres/shopify?erreur=Session indisponible.");
  const parsed = connectionSchema.safeParse({
    shopDomain: formData.get("shopDomain"),
    clientId: formData.get("clientId"),
    clientSecret: formData.get("clientSecret"),
  });
  if (!parsed.success) redirect("/parametres/shopify?erreur=Vérifiez le domaine, le Client ID et le Client Secret Shopify.");

  let shopDomain: string | undefined;
  let connectionId: string | undefined;
  try {
    shopDomain = normalizeShopDomain(parsed.data.shopDomain);
    const webhookUrl = getShopifyWebhookUrl();
    const token = await requestShopifyToken({
      shopDomain,
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret,
    });
    const shop = await fetchShopifyShop({ shopDomain, accessToken: token.accessToken });
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("upsert_shopify_connection", {
      p_business_id: context.businessId,
      p_actor: context.userId,
      p_shop_domain: shopDomain,
      p_client_id: parsed.data.clientId,
      p_client_secret: parsed.data.clientSecret,
      p_access_token: token.accessToken,
      p_access_token_expires_at: token.expiresAt,
      p_shopify_shop_gid: shop.id,
      p_shop_name: shop.name,
      p_shop_currency: shop.currencyCode,
      p_granted_scopes: token.scopes,
    });
    if (error) {
      if (error.code === "23505") throw new ShopifyError("SHOP_DOMAIN_ALREADY_CONNECTED");
      if (error.message.includes("SHOP_DOMAIN_CHANGE_REQUIRES_DISCONNECT")) {
        throw new ShopifyError("SHOP_DOMAIN_CHANGE_REQUIRES_DISCONNECT");
      }
      throw new ShopifyError("SHOPIFY_UNAVAILABLE");
    }
    if (typeof data !== "string") throw new ShopifyError("SHOPIFY_RESPONSE_INVALID");
    connectionId = data;

    let subscriptions;
    try {
      subscriptions = await reconcileShopifyWebhooks({
        shopDomain,
        accessToken: token.accessToken,
        webhookUrl,
        onPartialFailure: () => markShopifyWebhooksPartial(context, data),
      });
    } catch (error) {
      if (error instanceof ShopifyError && error.code === "SITE_URL_INVALID") throw error;
      throw new ShopifyError("SHOPIFY_WEBHOOKS_PARTIAL");
    }
    const stored = await admin.rpc("replace_shopify_webhook_subscriptions", {
      p_connection_id: connectionId,
      p_business_id: context.businessId,
      p_actor: context.userId,
      p_subscriptions: subscriptions,
    });
    if (stored.error || stored.data !== 5) {
      await markShopifyWebhooksPartial(context, connectionId);
      throw new ShopifyError("SHOPIFY_WEBHOOKS_PARTIAL");
    }
  } catch (error) {
    errorRedirect(error, { businessId: context.businessId, connectionId, shopDomain });
  }

  revalidatePath("/parametres");
  revalidatePath("/parametres/shopify");
  redirect("/parametres/shopify?message=connecte");
}

export async function testShopifyConnectionAction() {
  const context = await actionContext();
  if (!context) redirect("/parametres/shopify?erreur=Session indisponible.");
  const status = await getShopifyConnectionStatus(context.businessId);
  if (!status) errorRedirect(new ShopifyError("SHOPIFY_CONNECTION_NOT_FOUND"), { businessId: context.businessId });

  try {
    const { accessToken, credentials } = await getShopifyAccessToken(status.id);
    await fetchShopifyShop({ shopDomain: credentials.shop_domain, accessToken });
    const admin = createAdminClient();
    const { error } = await admin.rpc("mark_shopify_connection_verified", {
      p_connection_id: status.id,
      p_business_id: context.businessId,
      p_actor: context.userId,
      p_granted_scopes: credentials.granted_scopes,
    });
    if (error) throw new ShopifyError("SHOPIFY_UNAVAILABLE");
  } catch (error) {
    errorRedirect(error, { businessId: context.businessId, connectionId: status.id, shopDomain: status.shop_domain });
  }

  revalidatePath("/parametres/shopify");
  redirect("/parametres/shopify?message=connexion-verifiee");
}

export async function verifyShopifyWebhooksAction() {
  const context = await actionContext();
  if (!context) redirect("/parametres/shopify?erreur=Session indisponible.");
  const status = await getShopifyConnectionStatus(context.businessId);
  if (!status) errorRedirect(new ShopifyError("SHOPIFY_CONNECTION_NOT_FOUND"), { businessId: context.businessId });

  try {
    const { accessToken, credentials } = await getShopifyAccessToken(status.id);
    const admin = createAdminClient();
    let subscriptions;
    try {
      subscriptions = await reconcileShopifyWebhooks({
        shopDomain: credentials.shop_domain,
        accessToken,
        webhookUrl: getShopifyWebhookUrl(),
      });
    } catch {
      await markShopifyWebhooksPartial(context, status.id);
      throw new ShopifyError("SHOPIFY_WEBHOOKS_PARTIAL");
    }
    const { data, error } = await admin.rpc("replace_shopify_webhook_subscriptions", {
      p_connection_id: status.id,
      p_business_id: context.businessId,
      p_actor: context.userId,
      p_subscriptions: subscriptions,
    });
    if (error || data !== 5) {
      await markShopifyWebhooksPartial(context, status.id);
      throw new ShopifyError("SHOPIFY_WEBHOOKS_PARTIAL");
    }
  } catch (error) {
    errorRedirect(error, { businessId: context.businessId, connectionId: status.id, shopDomain: status.shop_domain });
  }

  revalidatePath("/parametres/shopify");
  redirect("/parametres/shopify?message=webhooks-verifies");
}

export async function disconnectShopifyAction() {
  const context = await actionContext();
  if (!context) redirect("/parametres/shopify?erreur=Session indisponible.");
  const status = await getShopifyConnectionStatus(context.businessId);
  if (!status) errorRedirect(new ShopifyError("SHOPIFY_CONNECTION_NOT_FOUND"), { businessId: context.businessId });

  try {
    const { accessToken, credentials } = await getShopifyAccessToken(status.id);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_shopify_backend_webhook_subscriptions", {
      p_connection_id: status.id,
    });
    if (error) throw new ShopifyError("SHOPIFY_WEBHOOKS_PARTIAL");
    const subscriptionIds = Array.isArray(data)
      ? data.flatMap((row: unknown) => {
        if (typeof row !== "object" || row === null || !("shopify_subscription_gid" in row)) return [];
        const id = (row as { shopify_subscription_gid?: unknown }).shopify_subscription_gid;
        return typeof id === "string" ? [id] : [];
      })
      : [];
    await deleteYrelComptaWebhooks({
      shopDomain: credentials.shop_domain,
      accessToken,
      webhookUrl: getShopifyWebhookUrl(),
      knownSubscriptionIds: subscriptionIds,
    });
    const disconnected = await admin.rpc("disconnect_shopify_connection", {
      p_connection_id: status.id,
      p_business_id: context.businessId,
      p_actor: context.userId,
    });
    if (disconnected.error) throw new ShopifyError("SHOPIFY_UNAVAILABLE");
  } catch (error) {
    errorRedirect(error, { businessId: context.businessId, connectionId: status.id, shopDomain: status.shop_domain });
  }

  revalidatePath("/parametres");
  revalidatePath("/parametres/shopify");
  redirect("/parametres/shopify?message=deconnecte");
}
