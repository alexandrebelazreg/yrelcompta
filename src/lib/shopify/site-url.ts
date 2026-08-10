import { SHOPIFY_WEBHOOK_PATH } from "./constants";
import { ShopifyError } from "./errors";

export function getShopifyWebhookUrl(siteUrl = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!siteUrl) throw new ShopifyError("SITE_URL_INVALID");

  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new ShopifyError("SITE_URL_INVALID");
  }

  const production = process.env.NODE_ENV === "production";
  const localDevelopment = !production && url.hostname === "localhost" && url.protocol === "http:";
  if ((production && (url.protocol !== "https:" || url.hostname === "localhost"))
    || (!production && !localDevelopment && url.protocol !== "https:")
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash) {
    throw new ShopifyError("SITE_URL_INVALID");
  }

  return `${url.origin}${SHOPIFY_WEBHOOK_PATH}`;
}
