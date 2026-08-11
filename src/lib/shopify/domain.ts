import { SHOPIFY_API_VERSION } from "./constants";
import { ShopifyError } from "./errors";

const shopDomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const shopHandlePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeShopDomain(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (!candidate || candidate === "localhost" || candidate.includes("://") || /[/?#@:\s]/.test(candidate)) {
    throw new ShopifyError("SHOP_DOMAIN_INVALID");
  }

  const normalized = candidate.endsWith(".myshopify.com")
    ? candidate
    : shopHandlePattern.test(candidate)
      ? `${candidate}.myshopify.com`
      : candidate;

  if (!shopDomainPattern.test(normalized)) throw new ShopifyError("SHOP_DOMAIN_INVALID");
  return normalized;
}

export function shopifyAdminGraphqlUrl(shopDomain: string): string {
  const normalized = normalizeShopDomain(shopDomain);
  return `https://${normalized}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

export function shopifyTokenUrl(shopDomain: string): string {
  return `https://${normalizeShopDomain(shopDomain)}/admin/oauth/access_token`;
}
