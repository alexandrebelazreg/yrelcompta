import { describe, expect, it } from "vitest";
import { normalizeShopDomain, shopifyAdminGraphqlUrl, shopifyTokenUrl } from "./domain";

describe("normalisation du domaine Shopify", () => {
  it("complète un identifiant de boutique", () => {
    expect(normalizeShopDomain("maboutique")).toBe("maboutique.myshopify.com");
  });

  it("conserve un domaine myshopify canonique", () => {
    expect(normalizeShopDomain("Ma-Boutique.myshopify.com")).toBe("ma-boutique.myshopify.com");
  });

  it.each([
    "https://maboutique.myshopify.com",
    "evil.com",
    "myshopify.com.evil.com",
    "localhost",
    "127.0.0.1",
    "maboutique.myshopify.com/path",
    "maboutique.myshopify.com?x=1",
  ])("refuse la cible SSRF %s", (value) => {
    expect(() => normalizeShopDomain(value)).toThrow("SHOP_DOMAIN_INVALID");
  });

  it("construit uniquement les endpoints Shopify attendus", () => {
    expect(shopifyTokenUrl("maboutique")).toBe("https://maboutique.myshopify.com/admin/oauth/access_token");
    expect(shopifyAdminGraphqlUrl("maboutique")).toBe("https://maboutique.myshopify.com/admin/api/2026-07/graphql.json");
  });
});
