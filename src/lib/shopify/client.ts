import { shopifyAdminGraphqlUrl, normalizeShopDomain } from "./domain";
import { ShopifyError } from "./errors";
import type { ShopifyShop } from "./types";

type FetchImplementation = typeof fetch;

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function shopifyGraphql<T>({
  shopDomain,
  accessToken,
  query,
  variables,
  fetchImpl = fetch,
}: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: FetchImplementation;
}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(shopifyAdminGraphqlUrl(shopDomain), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch {
    throw new ShopifyError("SHOPIFY_UNAVAILABLE");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ShopifyError(response.ok ? "SHOPIFY_RESPONSE_INVALID" : "SHOPIFY_UNAVAILABLE", response.status);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ShopifyError("SHOPIFY_CREDENTIALS_REJECTED", response.status);
    }
    throw new ShopifyError("SHOPIFY_UNAVAILABLE", response.status);
  }
  if (!isRecord(payload)) throw new ShopifyError("SHOPIFY_RESPONSE_INVALID", response.status);

  const envelope = payload as GraphqlEnvelope<T>;
  if (envelope.errors?.length) throw new ShopifyError("SHOPIFY_GRAPHQL_ERROR", response.status);
  if (envelope.data === undefined) throw new ShopifyError("SHOPIFY_RESPONSE_INVALID", response.status);
  return envelope.data;
}

const SHOP_QUERY = `#graphql
  query YrelComptaShopConnection {
    shop {
      id
      name
      myshopifyDomain
      currencyCode
    }
  }
`;

export async function fetchShopifyShop({
  shopDomain,
  accessToken,
  fetchImpl,
}: {
  shopDomain: string;
  accessToken: string;
  fetchImpl?: FetchImplementation;
}): Promise<ShopifyShop> {
  const data = await shopifyGraphql<{ shop?: unknown }>({
    shopDomain,
    accessToken,
    query: SHOP_QUERY,
    fetchImpl,
  });
  if (!isRecord(data.shop)
    || typeof data.shop.id !== "string"
    || typeof data.shop.name !== "string"
    || typeof data.shop.myshopifyDomain !== "string"
    || typeof data.shop.currencyCode !== "string") {
    throw new ShopifyError("SHOPIFY_SHOP_NOT_FOUND");
  }

  const returnedDomain = normalizeShopDomain(data.shop.myshopifyDomain);
  const requestedDomain = normalizeShopDomain(shopDomain);
  if (returnedDomain !== requestedDomain) throw new ShopifyError("SHOP_DOMAIN_MISMATCH");
  if (data.shop.currencyCode !== "EUR") throw new ShopifyError("SHOP_CURRENCY_UNSUPPORTED");

  return {
    id: data.shop.id,
    name: data.shop.name,
    myshopifyDomain: returnedDomain,
    currencyCode: data.shop.currencyCode,
  };
}
