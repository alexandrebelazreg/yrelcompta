import { describe, expect, it } from "vitest";
import { getShopifyWebhookUrl } from "./site-url";

describe("URL publique des webhooks Shopify", () => {
  it("construit l’endpoint depuis NEXT_PUBLIC_SITE_URL", () => {
    expect(getShopifyWebhookUrl("https://yrelcompta.netlify.app"))
      .toBe("https://yrelcompta.netlify.app/api/integrations/shopify/webhook");
  });

  it("autorise localhost en HTTP pour le développement local", () => {
    expect(getShopifyWebhookUrl("http://localhost:3000"))
      .toBe("http://localhost:3000/api/integrations/shopify/webhook");
  });

  it.each([
    "http://example.com",
    "https://example.com/chemin",
    "https://user:password@example.com",
    "javascript:alert(1)",
  ])("refuse une URL publique dangereuse : %s", (value) => {
    expect(() => getShopifyWebhookUrl(value)).toThrow("SITE_URL_INVALID");
  });
});
