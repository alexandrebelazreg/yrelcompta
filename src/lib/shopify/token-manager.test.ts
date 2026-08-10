import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getShopifyAccessToken } from "./token-manager";
import type { ShopifyBackendCredentials } from "./types";

const now = Date.UTC(2026, 7, 10, 10, 0, 0);
const credentials: ShopifyBackendCredentials = {
  connection_id: "11111111-1111-4111-8111-111111111111",
  business_id: "22222222-2222-4222-8222-222222222222",
  shop_domain: "maboutique.myshopify.com",
  client_id: "client_id_123",
  client_secret: "client_secret_123",
  access_token: "cached_token_123",
  access_token_expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
  granted_scopes: ["read_orders", "read_products"],
};

describe("renouvellement central du token Shopify", () => {
  it("réutilise un token valable au-delà de la marge de cinq minutes", async () => {
    const requestToken = vi.fn();
    const cacheToken = vi.fn();
    const result = await getShopifyAccessToken(credentials.connection_id, {
      now: () => now,
      loadCredentials: async () => credentials,
      requestToken,
      cacheToken,
    });
    expect(result.accessToken).toBe("cached_token_123");
    expect(requestToken).not.toHaveBeenCalled();
    expect(cacheToken).not.toHaveBeenCalled();
  });

  it("renouvelle et recache un token proche de l’expiration", async () => {
    const expiring = { ...credentials, access_token_expires_at: new Date(now + 4 * 60 * 1000).toISOString() };
    const renewed = {
      accessToken: "renewed_token_123",
      scopes: ["read_orders", "read_products"],
      expiresAt: new Date(now + 86399 * 1000).toISOString(),
    };
    const requestToken = vi.fn(async () => renewed);
    const cacheToken = vi.fn(async () => undefined);
    const result = await getShopifyAccessToken(credentials.connection_id, {
      now: () => now,
      loadCredentials: async () => expiring,
      requestToken,
      cacheToken,
    });
    expect(result.accessToken).toBe("renewed_token_123");
    expect(requestToken).toHaveBeenCalledOnce();
    expect(cacheToken).toHaveBeenCalledWith(credentials.connection_id, renewed);
  });
});
