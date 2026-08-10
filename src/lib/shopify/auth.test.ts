import { describe, expect, it, vi } from "vitest";
import {
  assertRequiredShopifyScopes,
  requestShopifyToken,
  validateShopifyClientSecret,
} from "./auth";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("authentification Shopify client credentials", () => {
  it("refuse un Client Secret absent ou invalide", () => {
    expect(() => validateShopifyClientSecret("")).toThrow("CLIENT_SECRET_INVALID");
    expect(() => validateShopifyClientSecret("secret\ninjecté")).toThrow("CLIENT_SECRET_INVALID");
  });

  it("parse le token, les scopes et expires_in", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      access_token: "shpat_token_test",
      scope: "read_products,read_orders",
      expires_in: 86399,
    }));
    const token = await requestShopifyToken({
      shopDomain: "maboutique",
      clientId: "client_id_123",
      clientSecret: "client_secret_123",
      fetchImpl,
      now: Date.UTC(2026, 7, 10, 10, 0, 0),
    });
    expect(token.accessToken).toBe("shpat_token_test");
    expect(token.scopes).toEqual(["read_orders", "read_products"]);
    expect(token.expiresAt).toBe("2026-08-11T09:59:59.000Z");
    const [, options] = fetchImpl.mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(String(options?.body)).toContain("grant_type=client_credentials");
  });

  it.each([
    [["read_products"], "SHOPIFY_SCOPE_READ_ORDERS_MISSING"],
    [["read_orders"], "SHOPIFY_SCOPE_READ_PRODUCTS_MISSING"],
  ] as const)("signale précisément une permission manquante", (scopes, code) => {
    expect(() => assertRequiredShopifyScopes(scopes)).toThrow(code);
  });

  it("traduit shop_not_permitted sans exposer la réponse", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "shop_not_permitted", detail: "sensible" }, 403));
    await expect(requestShopifyToken({
      shopDomain: "maboutique",
      clientId: "client_id_123",
      clientSecret: "client_secret_123",
      fetchImpl,
    })).rejects.toThrow("SHOP_NOT_PERMITTED");
  });

  it("refuse une réponse OAuth mal formée", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ access_token: "token" }));
    await expect(requestShopifyToken({
      shopDomain: "maboutique",
      clientId: "client_id_123",
      clientSecret: "client_secret_123",
      fetchImpl,
    })).rejects.toThrow("SHOPIFY_RESPONSE_INVALID");
  });

  it("traduit une erreur HTTP Shopify en indisponibilité", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "server_error" }, 503));
    await expect(requestShopifyToken({
      shopDomain: "maboutique",
      clientId: "client_id_123",
      clientSecret: "client_secret_123",
      fetchImpl,
    })).rejects.toThrow("SHOPIFY_UNAVAILABLE");
  });
});
