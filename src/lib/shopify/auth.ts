import { SHOPIFY_REQUIRED_SCOPES } from "./constants";
import { shopifyTokenUrl } from "./domain";
import { ShopifyError } from "./errors";
import type { ShopifyToken } from "./types";

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateShopifyClientId(value: string): string {
  const clientId = value.trim();
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(clientId)) throw new ShopifyError("CLIENT_ID_INVALID");
  return clientId;
}

export function validateShopifyClientSecret(value: string): string {
  if (value.length < 8 || value.length > 255 || /[\u0000\r\n]/.test(value)) {
    throw new ShopifyError("CLIENT_SECRET_INVALID");
  }
  return value;
}

export function parseShopifyScopes(value: string): string[] {
  return [...new Set(value.split(",").map((scope) => scope.trim()).filter(Boolean))].sort();
}

export function assertRequiredShopifyScopes(scopes: readonly string[]): void {
  if (!scopes.includes(SHOPIFY_REQUIRED_SCOPES[0])) {
    throw new ShopifyError("SHOPIFY_SCOPE_READ_ORDERS_MISSING");
  }
  if (!scopes.includes(SHOPIFY_REQUIRED_SCOPES[1])) {
    throw new ShopifyError("SHOPIFY_SCOPE_READ_PRODUCTS_MISSING");
  }
}

export async function requestShopifyToken({
  shopDomain,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = Date.now(),
}: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchImplementation;
  now?: number;
}): Promise<ShopifyToken> {
  const validatedClientId = validateShopifyClientId(clientId);
  const validatedClientSecret = validateShopifyClientSecret(clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: validatedClientId,
    client_secret: validatedClientSecret,
  });

  let response: Response;
  try {
    response = await fetchImpl(shopifyTokenUrl(shopDomain), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
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
    const errorCode = isRecord(payload) && typeof payload.error === "string" ? payload.error : "";
    if (errorCode === "shop_not_permitted") throw new ShopifyError("SHOP_NOT_PERMITTED", response.status);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new ShopifyError("SHOPIFY_CREDENTIALS_REJECTED", response.status);
    }
    throw new ShopifyError("SHOPIFY_UNAVAILABLE", response.status);
  }

  if (!isRecord(payload)
    || typeof payload.access_token !== "string"
    || payload.access_token.length < 8
    || typeof payload.scope !== "string"
    || typeof payload.expires_in !== "number"
    || !Number.isSafeInteger(payload.expires_in)
    || payload.expires_in < 300
    || payload.expires_in > 172800) {
    throw new ShopifyError("SHOPIFY_RESPONSE_INVALID", response.status);
  }

  const scopes = parseShopifyScopes(payload.scope);
  assertRequiredShopifyScopes(scopes);
  return {
    accessToken: payload.access_token,
    scopes,
    expiresAt: new Date(now + payload.expires_in * 1000).toISOString(),
  };
}
