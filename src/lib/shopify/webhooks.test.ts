import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SHOPIFY_WEBHOOK_TOPICS } from "./constants";
import {
  extractShopifyResourceIds,
  hashShopifyWebhookPayload,
  parseShopifyWebhookTopic,
  reconcileShopifyWebhooks,
  verifyShopifyWebhookHmac,
  verifyShopifyWebhookHmacWithRotation,
} from "./webhooks";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function graphqlRequest(options?: RequestInit) {
  return JSON.parse(String(options?.body)) as { query: string; variables: Record<string, unknown> };
}

describe("webhooks Shopify", () => {
  it("accepte un HMAC valide calculé sur le corps brut exact", () => {
    const rawBody = '{"id":1,"name":"Élodie"}\n';
    const secret = "client_secret_test";
    const hmac = createHmac("sha256", secret).update(rawBody).digest("base64");
    expect(verifyShopifyWebhookHmac(rawBody, hmac, secret)).toBe(true);
    expect(hashShopifyWebhookPayload(rawBody)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejette un HMAC invalide et un body modifié après signature", () => {
    const original = '{"id":1}';
    const hmac = createHmac("sha256", "secret-test").update(original).digest("base64");
    expect(verifyShopifyWebhookHmac(original, "HMAC-invalide", "secret-test")).toBe(false);
    expect(verifyShopifyWebhookHmac('{"id":2}', hmac, "secret-test")).toBe(false);
  });

  it("accepte le secret courant pendant une rotation", () => {
    const rawBody = '{"id":1}';
    const hmac = createHmac("sha256", "current-secret").update(rawBody).digest("base64");
    expect(verifyShopifyWebhookHmacWithRotation(rawBody, hmac, {
      clientSecret: "current-secret",
      previousClientSecret: "previous-secret",
      previousClientSecretValidUntil: "2026-08-10T11:05:00.000Z",
    }, Date.parse("2026-08-10T10:00:00.000Z"))).toBe(true);
  });

  it("accepte le secret précédent uniquement pendant les 65 minutes de grâce", () => {
    const rawBody = '{"id":1}';
    const hmac = createHmac("sha256", "previous-secret").update(rawBody).digest("base64");
    expect(verifyShopifyWebhookHmacWithRotation(rawBody, hmac, {
      clientSecret: "current-secret",
      previousClientSecret: "previous-secret",
      previousClientSecretValidUntil: "2026-08-10T11:05:00.000Z",
    }, Date.parse("2026-08-10T11:04:59.000Z"))).toBe(true);
  });

  it("rejette le secret précédent expiré", () => {
    const rawBody = '{"id":1}';
    const hmac = createHmac("sha256", "previous-secret").update(rawBody).digest("base64");
    expect(verifyShopifyWebhookHmacWithRotation(rawBody, hmac, {
      clientSecret: "current-secret",
      previousClientSecret: "previous-secret",
      previousClientSecretValidUntil: "2026-08-10T11:05:00.000Z",
    }, Date.parse("2026-08-10T11:05:00.000Z"))).toBe(false);
  });

  it("rejette un secret totalement inconnu", () => {
    const rawBody = '{"id":1}';
    const hmac = createHmac("sha256", "unknown-secret").update(rawBody).digest("base64");
    expect(verifyShopifyWebhookHmacWithRotation(rawBody, hmac, {
      clientSecret: "current-secret",
      previousClientSecret: "previous-secret",
      previousClientSecretValidUntil: "2026-08-10T11:05:00.000Z",
    }, Date.parse("2026-08-10T10:00:00.000Z"))).toBe(false);
  });

  it("normalise les topics reçus dans les headers", () => {
    expect(parseShopifyWebhookTopic("orders/create")).toBe("ORDERS_CREATE");
    expect(parseShopifyWebhookTopic("REFUNDS_CREATE")).toBe("REFUNDS_CREATE");
    expect(parseShopifyWebhookTopic("customers/create")).toBeNull();
  });

  it("n’extrait que les identifiants minimaux sans données personnelles", () => {
    const result = extractShopifyResourceIds("ORDERS_CREATE", {
      admin_graphql_api_id: "gid://shopify/Order/123",
      email: "cliente@example.test",
      shipping_address: { name: "Donnée privée" },
    });
    expect(result).toEqual({
      orderGid: "gid://shopify/Order/123",
      resourceId: "gid://shopify/Order/123",
    });
    expect(JSON.stringify(result)).not.toContain("cliente");
  });

  it("crée exactement les cinq subscriptions absentes", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const request = graphqlRequest(options);
      if (request.query.includes("YrelComptaWebhookSubscriptions")) {
        return jsonResponse({ data: { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      const topic = String(request.variables.topic);
      return jsonResponse({ data: { webhookSubscriptionCreate: {
        webhookSubscription: { id: `gid://shopify/WebhookSubscription/${SHOPIFY_WEBHOOK_TOPICS.indexOf(topic as never) + 1}`, topic, uri: "https://yrelcompta.test/api/integrations/shopify/webhook" },
        userErrors: [],
      } } });
    });
    const subscriptions = await reconcileShopifyWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: "https://yrelcompta.test/api/integrations/shopify/webhook",
      fetchImpl,
    });
    expect(subscriptions.map((subscription) => subscription.topic)).toEqual(SHOPIFY_WEBHOOK_TOPICS);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("reste idempotent quand les cinq subscriptions exactes existent", async () => {
    const nodes = SHOPIFY_WEBHOOK_TOPICS.map((topic, index) => ({
      id: `gid://shopify/WebhookSubscription/${index + 1}`,
      topic,
      uri: "https://yrelcompta.test/api/integrations/shopify/webhook",
    }));
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: { webhookSubscriptions: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } },
    }));
    const subscriptions = await reconcileShopifyWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: "https://yrelcompta.test/api/integrations/shopify/webhook",
      fetchImpl,
    });
    expect(subscriptions).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuse les userErrors GraphQL lors d’une création", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const request = graphqlRequest(options);
      if (request.query.includes("YrelComptaWebhookSubscriptions")) {
        return jsonResponse({ data: { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      return jsonResponse({ data: { webhookSubscriptionCreate: {
        webhookSubscription: null,
        userErrors: [{ field: ["webhookSubscription", "uri"], message: "URI refusée" }],
      } } });
    });
    await expect(reconcileShopifyWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: "https://yrelcompta.test/api/integrations/shopify/webhook",
      fetchImpl,
    })).rejects.toThrow("SHOPIFY_GRAPHQL_ERROR");
  });
});
