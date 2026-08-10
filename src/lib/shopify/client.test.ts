import { describe, expect, it, vi } from "vitest";
import { fetchShopifyShop } from "./client";

function shopResponse(overrides: Record<string, string> = {}) {
  return new Response(JSON.stringify({
    data: {
      shop: {
        id: "gid://shopify/Shop/123",
        name: "Atelier poudré",
        myshopifyDomain: "maboutique.myshopify.com",
        currencyCode: "EUR",
        ...overrides,
      },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("vérification GraphQL de la boutique", () => {
  it("accepte la boutique demandée en EUR", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => shopResponse());
    const shop = await fetchShopifyShop({ shopDomain: "maboutique", accessToken: "token-test", fetchImpl });
    expect(shop).toMatchObject({ myshopifyDomain: "maboutique.myshopify.com", currencyCode: "EUR" });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://maboutique.myshopify.com/admin/api/2026-07/graphql.json");
    expect(options?.headers).toMatchObject({ "X-Shopify-Access-Token": "token-test" });
  });

  it("refuse un domaine retourné différent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => shopResponse({ myshopifyDomain: "autre.myshopify.com" }));
    await expect(fetchShopifyShop({ shopDomain: "maboutique", accessToken: "token-test", fetchImpl }))
      .rejects.toThrow("SHOP_DOMAIN_MISMATCH");
  });

  it("refuse une devise autre que EUR", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => shopResponse({ currencyCode: "USD" }));
    await expect(fetchShopifyShop({ shopDomain: "maboutique", accessToken: "token-test", fetchImpl }))
      .rejects.toThrow("SHOP_CURRENCY_UNSUPPORTED");
  });

  it("refuse les erreurs GraphQL sans en exposer le message", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      errors: [{ message: "détail potentiellement sensible" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(fetchShopifyShop({ shopDomain: "maboutique", accessToken: "token-test", fetchImpl }))
      .rejects.toThrow("SHOPIFY_GRAPHQL_ERROR");
  });
});
