import { afterEach, describe, expect, it, vi } from "vitest";
import { getShopifyWebhookUrl } from "./site-url";

afterEach(() => vi.unstubAllEnvs());

describe("URL publique des webhooks Shopify", () => {
  it("construit l’endpoint depuis NEXT_PUBLIC_SITE_URL", () => {
    expect(getShopifyWebhookUrl("https://yrelcompta.netlify.app"))
      .toBe("https://yrelcompta.netlify.app/api/integrations/shopify/webhook");
  });

  it("autorise localhost en HTTP pour le développement local", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getShopifyWebhookUrl("http://localhost:3000"))
      .toBe("http://localhost:3000/api/integrations/shopify/webhook");
  });

  it("refuse localhost en HTTP en production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getShopifyWebhookUrl("http://localhost:3000")).toThrow("SITE_URL_INVALID");
  });

  it("accepte une origine HTTPS en production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getShopifyWebhookUrl("https://yrelcompta.netlify.app"))
      .toBe("https://yrelcompta.netlify.app/api/integrations/shopify/webhook");
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
