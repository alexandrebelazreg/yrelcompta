import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SHOPIFY_WEBHOOK_PATH, SHOPIFY_WEBHOOK_TOPICS, type ShopifyWebhookTopic } from "./constants";
import { ShopifyError } from "./errors";
import { shopifyGraphql } from "./client";
import type { ShopifyWebhookSubscription } from "./types";

type FetchImplementation = typeof fetch;

export interface ShopifyListedWebhookSubscription {
  id: string;
  topic: string;
  uri: string;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

interface WebhookListData {
  webhookSubscriptions: {
    nodes: ShopifyListedWebhookSubscription[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

function assertNoUserErrors(errors: UserError[] | undefined): void {
  if (errors?.length) throw new ShopifyError("SHOPIFY_GRAPHQL_ERROR");
}

export function isShopifyWebhookTopic(value: string): value is ShopifyWebhookTopic {
  return (SHOPIFY_WEBHOOK_TOPICS as readonly string[]).includes(value);
}

const headerTopicMap: Record<string, ShopifyWebhookTopic> = {
  "orders/create": "ORDERS_CREATE",
  "orders/updated": "ORDERS_UPDATED",
  "orders/paid": "ORDERS_PAID",
  "orders/cancelled": "ORDERS_CANCELLED",
  "refunds/create": "REFUNDS_CREATE",
};

export function parseShopifyWebhookTopic(value: string): ShopifyWebhookTopic | null {
  if (isShopifyWebhookTopic(value)) return value;
  return headerTopicMap[value.toLowerCase()] ?? null;
}

export function verifyShopifyWebhookHmac(rawBody: string | Buffer, receivedHmac: string, clientSecret: string): boolean {
  const expected = Buffer.from(createHmac("sha256", clientSecret).update(rawBody).digest("base64"));
  const received = Buffer.from(receivedHmac.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function verifyShopifyWebhookHmacWithRotation(
  rawBody: string | Buffer,
  receivedHmac: string,
  secrets: {
    clientSecret: string;
    previousClientSecret: string | null;
    previousClientSecretValidUntil: string | null;
  },
  now = Date.now(),
): boolean {
  if (verifyShopifyWebhookHmac(rawBody, receivedHmac, secrets.clientSecret)) return true;

  const previousValidUntil = secrets.previousClientSecretValidUntil
    ? Date.parse(secrets.previousClientSecretValidUntil)
    : Number.NaN;
  return Boolean(
    secrets.previousClientSecret
    && Number.isFinite(previousValidUntil)
    && previousValidUntil > now
    && verifyShopifyWebhookHmac(rawBody, receivedHmac, secrets.previousClientSecret),
  );
}

export function hashShopifyWebhookPayload(rawBody: string | Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function extractShopifyResourceIds(topic: ShopifyWebhookTopic, payload: unknown): {
  orderGid: string | null;
  resourceId: string | null;
} {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { orderGid: null, resourceId: null };
  }
  const row = payload as Record<string, unknown>;
  const resourceId = typeof row.admin_graphql_api_id === "string" ? row.admin_graphql_api_id.slice(0, 200) : null;
  if (topic === "REFUNDS_CREATE") {
    const orderId = typeof row.order_id === "number" || typeof row.order_id === "string" ? String(row.order_id) : null;
    return {
      orderGid: orderId && /^[0-9]+$/.test(orderId) ? `gid://shopify/Order/${orderId}` : null,
      resourceId,
    };
  }
  return {
    orderGid: resourceId?.startsWith("gid://shopify/Order/") ? resourceId : null,
    resourceId,
  };
}

export async function listShopifyWebhookSubscriptions(
  shopDomain: string,
  accessToken: string,
  fetchImpl?: FetchImplementation,
): Promise<ShopifyListedWebhookSubscription[]> {
  const subscriptions: ShopifyListedWebhookSubscription[] = [];
  let cursor: string | null = null;
  do {
    const data: WebhookListData = await shopifyGraphql<WebhookListData>({
      shopDomain,
      accessToken,
      query: `#graphql
        query YrelComptaWebhookSubscriptions($after: String) {
          webhookSubscriptions(first: 100, after: $after) {
            nodes { id topic uri }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      variables: { after: cursor },
      fetchImpl,
    });
    subscriptions.push(...data.webhookSubscriptions.nodes);
    cursor = data.webhookSubscriptions.pageInfo.hasNextPage
      ? data.webhookSubscriptions.pageInfo.endCursor
      : null;
  } while (cursor);
  return subscriptions;
}

async function createWebhookSubscription(
  shopDomain: string,
  accessToken: string,
  topic: ShopifyWebhookTopic,
  uri: string,
  fetchImpl?: FetchImplementation,
): Promise<ShopifyListedWebhookSubscription> {
  const data = await shopifyGraphql<{
    webhookSubscriptionCreate: { webhookSubscription: ShopifyListedWebhookSubscription | null; userErrors: UserError[] };
  }>({
    shopDomain,
    accessToken,
    query: `#graphql
      mutation YrelComptaWebhookCreate($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) {
          webhookSubscription { id topic uri }
          userErrors { field message }
        }
      }
    `,
    variables: { topic, subscription: { uri, format: "JSON" } },
    fetchImpl,
  });
  assertNoUserErrors(data.webhookSubscriptionCreate.userErrors);
  if (!data.webhookSubscriptionCreate.webhookSubscription) throw new ShopifyError("SHOPIFY_RESPONSE_INVALID");
  return data.webhookSubscriptionCreate.webhookSubscription;
}

async function updateWebhookSubscription(
  shopDomain: string,
  accessToken: string,
  id: string,
  uri: string,
  fetchImpl?: FetchImplementation,
): Promise<ShopifyListedWebhookSubscription> {
  const data = await shopifyGraphql<{
    webhookSubscriptionUpdate: { webhookSubscription: ShopifyListedWebhookSubscription | null; userErrors: UserError[] };
  }>({
    shopDomain,
    accessToken,
    query: `#graphql
      mutation YrelComptaWebhookUpdate($id: ID!, $subscription: WebhookSubscriptionInput!) {
        webhookSubscriptionUpdate(id: $id, webhookSubscription: $subscription) {
          webhookSubscription { id topic uri }
          userErrors { field message }
        }
      }
    `,
    variables: { id, subscription: { uri, format: "JSON" } },
    fetchImpl,
  });
  assertNoUserErrors(data.webhookSubscriptionUpdate.userErrors);
  if (!data.webhookSubscriptionUpdate.webhookSubscription) throw new ShopifyError("SHOPIFY_RESPONSE_INVALID");
  return data.webhookSubscriptionUpdate.webhookSubscription;
}

export async function reconcileShopifyWebhooks({
  shopDomain,
  accessToken,
  webhookUrl,
  fetchImpl,
  onPartialFailure,
}: {
  shopDomain: string;
  accessToken: string;
  webhookUrl: string;
  fetchImpl?: FetchImplementation;
  onPartialFailure?: () => Promise<void>;
}): Promise<ShopifyWebhookSubscription[]> {
  try {
    const existing = await listShopifyWebhookSubscriptions(shopDomain, accessToken, fetchImpl);
    const reconciled: ShopifyWebhookSubscription[] = [];

    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      const exact = existing.find((subscription) => subscription.topic === topic && subscription.uri === webhookUrl);
      const managed = exact ?? existing.find((subscription) =>
        subscription.topic === topic && subscription.uri.endsWith(SHOPIFY_WEBHOOK_PATH));
      const subscription = exact
        ?? (managed
          ? await updateWebhookSubscription(shopDomain, accessToken, managed.id, webhookUrl, fetchImpl)
          : await createWebhookSubscription(shopDomain, accessToken, topic, webhookUrl, fetchImpl));
      reconciled.push({
        topic,
        shopify_subscription_gid: subscription.id,
        uri: subscription.uri,
      });
    }

    return reconciled;
  } catch (error) {
    await onPartialFailure?.();
    throw error;
  }
}

export function selectYrelComptaWebhookSubscriptionIds({
  knownSubscriptionIds,
  liveSubscriptions,
  webhookUrl,
}: {
  knownSubscriptionIds: readonly string[];
  liveSubscriptions: readonly ShopifyListedWebhookSubscription[];
  webhookUrl: string;
}): string[] {
  const selected = new Set(knownSubscriptionIds);
  for (const subscription of liveSubscriptions) {
    if (selected.has(subscription.id)
      || (isShopifyWebhookTopic(subscription.topic) && subscription.uri === webhookUrl)) {
      selected.add(subscription.id);
    }
  }
  return [...selected];
}

export async function deleteYrelComptaWebhooks({
  shopDomain,
  accessToken,
  webhookUrl,
  knownSubscriptionIds,
  fetchImpl,
}: {
  shopDomain: string;
  accessToken: string;
  webhookUrl: string;
  knownSubscriptionIds: readonly string[];
  fetchImpl?: FetchImplementation;
}): Promise<string[]> {
  const liveSubscriptions = await listShopifyWebhookSubscriptions(shopDomain, accessToken, fetchImpl);
  const subscriptionIds = selectYrelComptaWebhookSubscriptionIds({
    knownSubscriptionIds,
    liveSubscriptions,
    webhookUrl,
  });
  await deleteKnownShopifyWebhooks({ shopDomain, accessToken, subscriptionIds, fetchImpl });
  return subscriptionIds;
}

export async function deleteKnownShopifyWebhooks({
  shopDomain,
  accessToken,
  subscriptionIds,
  fetchImpl,
}: {
  shopDomain: string;
  accessToken: string;
  subscriptionIds: readonly string[];
  fetchImpl?: FetchImplementation;
}): Promise<void> {
  for (const id of subscriptionIds) {
    const data = await shopifyGraphql<{
      webhookSubscriptionDelete: { deletedWebhookSubscriptionId: string | null; userErrors: UserError[] };
    }>({
      shopDomain,
      accessToken,
      query: `#graphql
        mutation YrelComptaWebhookDelete($id: ID!) {
          webhookSubscriptionDelete(id: $id) {
            deletedWebhookSubscriptionId
            userErrors { field message }
          }
        }
      `,
      variables: { id },
      fetchImpl,
    });
    assertNoUserErrors(data.webhookSubscriptionDelete.userErrors);
    if (data.webhookSubscriptionDelete.deletedWebhookSubscriptionId !== id) {
      throw new ShopifyError("SHOPIFY_WEBHOOKS_PARTIAL");
    }
  }
}
