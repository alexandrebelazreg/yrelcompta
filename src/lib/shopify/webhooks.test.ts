import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SHOPIFY_WEBHOOK_TOPICS } from "./constants";
import {
  deleteYrelComptaWebhooks,
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

  it("marque la connexion partielle quand la troisième création échoue", async () => {
    let creationCount = 0;
    const onPartialFailure = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const request = graphqlRequest(options);
      if (request.query.includes("YrelComptaWebhookSubscriptions")) {
        return jsonResponse({ data: { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      creationCount += 1;
      if (creationCount === 3) {
        return jsonResponse({ data: { webhookSubscriptionCreate: {
          webhookSubscription: null,
          userErrors: [{ field: ["topic"], message: "Échec simulé" }],
        } } });
      }
      const topic = String(request.variables.topic);
      return jsonResponse({ data: { webhookSubscriptionCreate: {
        webhookSubscription: { id: `gid://shopify/WebhookSubscription/${creationCount}`, topic, uri: "https://yrelcompta.test/api/integrations/shopify/webhook" },
        userErrors: [],
      } } });
    });

    await expect(reconcileShopifyWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: "https://yrelcompta.test/api/integrations/shopify/webhook",
      fetchImpl,
      onPartialFailure,
    })).rejects.toThrow("SHOPIFY_GRAPHQL_ERROR");
    expect(creationCount).toBe(3);
    expect(onPartialFailure).toHaveBeenCalledOnce();
  });

  it("récupère et supprime les webhooks live jamais persistés sans toucher aux autres", async () => {
    const deletedIds: string[] = [];
    const callbackUrl = "https://yrelcompta.test/api/integrations/shopify/webhook";
    const live = [
      { id: "gid://shopify/WebhookSubscription/1", topic: "ORDERS_CREATE", uri: callbackUrl },
      { id: "gid://shopify/WebhookSubscription/2", topic: "ORDERS_UPDATED", uri: callbackUrl },
      { id: "gid://shopify/WebhookSubscription/3", topic: "ORDERS_PAID", uri: "https://autre.test/webhook" },
      { id: "gid://shopify/WebhookSubscription/4", topic: "PRODUCTS_UPDATE", uri: callbackUrl },
    ];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const request = graphqlRequest(options);
      if (request.query.includes("YrelComptaWebhookSubscriptions")) {
        return jsonResponse({ data: { webhookSubscriptions: { nodes: live, pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      const id = String(request.variables.id);
      deletedIds.push(id);
      return jsonResponse({ data: { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: id, userErrors: [] } } });
    });

    const selected = await deleteYrelComptaWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: callbackUrl,
      knownSubscriptionIds: [],
      fetchImpl,
    });
    expect(selected).toEqual([
      "gid://shopify/WebhookSubscription/1",
      "gid://shopify/WebhookSubscription/2",
    ]);
    expect(deletedIds).toEqual(selected);
  });

  it("déduplique l’union des GID locaux et live avant suppression", async () => {
    const deletedIds: string[] = [];
    const callbackUrl = "https://yrelcompta.test/api/integrations/shopify/webhook";
    const live = [1, 2, 3].map((id, index) => ({
      id: `gid://shopify/WebhookSubscription/${id}`,
      topic: SHOPIFY_WEBHOOK_TOPICS[index],
      uri: callbackUrl,
    }));
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const request = graphqlRequest(options);
      if (request.query.includes("YrelComptaWebhookSubscriptions")) {
        return jsonResponse({ data: { webhookSubscriptions: { nodes: live, pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      const id = String(request.variables.id);
      deletedIds.push(id);
      return jsonResponse({ data: { webhookSubscriptionDelete: { deletedWebhookSubscriptionId: id, userErrors: [] } } });
    });

    await deleteYrelComptaWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: callbackUrl,
      knownSubscriptionIds: [
        "gid://shopify/WebhookSubscription/1",
        "gid://shopify/WebhookSubscription/2",
      ],
      fetchImpl,
    });
    expect(deletedIds).toEqual([
      "gid://shopify/WebhookSubscription/1",
      "gid://shopify/WebhookSubscription/2",
      "gid://shopify/WebhookSubscription/3",
    ]);
  });

  it("ne supprime rien et remonte l’erreur si le listing live échoue", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "indisponible" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(deleteYrelComptaWebhooks({
      shopDomain: "maboutique",
      accessToken: "token-test",
      webhookUrl: "https://yrelcompta.test/api/integrations/shopify/webhook",
      knownSubscriptionIds: ["gid://shopify/WebhookSubscription/1"],
      fetchImpl,
    })).rejects.toThrow("SHOPIFY_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
