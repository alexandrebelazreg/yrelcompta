import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeShopDomain } from "@/lib/shopify/domain";
import { ShopifyError } from "@/lib/shopify/errors";
import { getShopifyBackendCredentialsByDomain } from "@/lib/shopify/token-manager";
import {
  extractShopifyResourceIds,
  hashShopifyWebhookPayload,
  parseShopifyWebhookTopic,
  verifyShopifyWebhookHmacWithRotation,
} from "@/lib/shopify/webhooks";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;

async function readRawBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) return new Response(null, { status: 400 });
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) return new Response(null, { status: 400 });
    if (declaredBytes > MAX_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  }

  const rawBody = await readRawBody(request);
  if (!rawBody) return new Response(null, { status: 413 });

  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const suppliedDomain = request.headers.get("x-shopify-shop-domain");
  const suppliedTopic = request.headers.get("x-shopify-topic");
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!hmac || !suppliedDomain || !suppliedTopic || !webhookId) {
    return new Response(null, { status: 400 });
  }

  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(suppliedDomain);
  } catch {
    return new Response(null, { status: 401 });
  }

  try {
    const credentials = await getShopifyBackendCredentialsByDomain(shopDomain);
    if (!credentials || !verifyShopifyWebhookHmacWithRotation(rawBody, hmac, {
      clientSecret: credentials.client_secret,
      previousClientSecret: credentials.previous_client_secret,
      previousClientSecretValidUntil: credentials.previous_client_secret_valid_until,
    })) {
      return new Response(null, { status: 401 });
    }

    const topic = parseShopifyWebhookTopic(suppliedTopic);
    if (!topic) return new Response(null, { status: 400 });

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return new Response(null, { status: 400 });
    }

    const { orderGid, resourceId } = extractShopifyResourceIds(topic, payload);
    const triggeredAtHeader = request.headers.get("x-shopify-triggered-at");
    const triggeredAt = triggeredAtHeader && Number.isFinite(Date.parse(triggeredAtHeader))
      ? new Date(triggeredAtHeader).toISOString()
      : null;
    const apiVersionHeader = request.headers.get("x-shopify-api-version");
    const apiVersion = apiVersionHeader && /^\d{4}-\d{2}$/.test(apiVersionHeader) ? apiVersionHeader : null;
    const eventId = request.headers.get("x-shopify-event-id");

    const admin = createAdminClient();
    const { error } = await admin.rpc("record_shopify_webhook_event", {
      p_connection_id: credentials.connection_id,
      p_business_id: credentials.business_id,
      p_webhook_id: webhookId.slice(0, 200),
      p_event_id: eventId?.slice(0, 200) ?? null,
      p_topic: topic,
      p_api_version: apiVersion,
      p_triggered_at: triggeredAt,
      p_shopify_order_gid: orderGid,
      p_shopify_resource_id: resourceId,
      p_payload_sha256: hashShopifyWebhookPayload(rawBody),
    });
    if (error) {
      console.error("Webhook Shopify non enregistré", {
        code: error.code,
        business_id: credentials.business_id,
        connection_id: credentials.connection_id,
        shop_domain: shopDomain,
      });
      return new Response(null, { status: 503 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Webhook Shopify refusé", {
      code: error instanceof ShopifyError ? error.code : "SHOPIFY_WEBHOOK_INTERNAL_ERROR",
      shop_domain: shopDomain,
    });
    return new Response(null, { status: 503 });
  }
}
