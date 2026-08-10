import "server-only";

import { createAdminClient } from "../supabase/admin";
import { requestShopifyToken, assertRequiredShopifyScopes } from "./auth";
import { SHOPIFY_TOKEN_REFRESH_MARGIN_MS } from "./constants";
import { ShopifyError } from "./errors";
import type { ShopifyBackendCredentials, ShopifyToken } from "./types";

interface TokenManagerDependencies {
  now: () => number;
  loadCredentials: (connectionId: string) => Promise<ShopifyBackendCredentials | null>;
  cacheToken: (connectionId: string, token: ShopifyToken) => Promise<void>;
  requestToken: typeof requestShopifyToken;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBackendCredentials(value: unknown): ShopifyBackendCredentials | null {
  const row = Array.isArray(value) ? value[0] : null;
  if (!isRecord(row)
    || typeof row.connection_id !== "string"
    || typeof row.business_id !== "string"
    || typeof row.shop_domain !== "string"
    || typeof row.client_id !== "string"
    || typeof row.client_secret !== "string"
    || typeof row.access_token !== "string"
    || typeof row.access_token_expires_at !== "string"
    || !Array.isArray(row.granted_scopes)
    || !row.granted_scopes.every((scope) => typeof scope === "string")) {
    return null;
  }
  return row as unknown as ShopifyBackendCredentials;
}

async function loadCredentials(connectionId: string): Promise<ShopifyBackendCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_shopify_backend_credentials", { p_connection_id: connectionId });
  if (error) {
    console.error("Lecture interne Shopify refusée", { code: error.code, connection_id: connectionId });
    throw new ShopifyError("SHOPIFY_CONNECTION_NOT_FOUND");
  }
  return parseBackendCredentials(data);
}

async function cacheToken(connectionId: string, token: ShopifyToken): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("cache_shopify_access_token", {
    p_connection_id: connectionId,
    p_access_token: token.accessToken,
    p_access_token_expires_at: token.expiresAt,
    p_granted_scopes: token.scopes,
  });
  if (error) {
    console.error("Cache Shopify refusé", { code: error.code, connection_id: connectionId });
    throw new ShopifyError("SHOPIFY_UNAVAILABLE");
  }
}

const defaultDependencies: TokenManagerDependencies = {
  now: Date.now,
  loadCredentials,
  cacheToken,
  requestToken: requestShopifyToken,
};

export async function getShopifyAccessToken(
  connectionId: string,
  dependencies: Partial<TokenManagerDependencies> = {},
): Promise<{ accessToken: string; credentials: ShopifyBackendCredentials }> {
  const deps = { ...defaultDependencies, ...dependencies };
  const credentials = await deps.loadCredentials(connectionId);
  if (!credentials) throw new ShopifyError("SHOPIFY_CONNECTION_NOT_FOUND");
  assertRequiredShopifyScopes(credentials.granted_scopes);

  const expiresAt = Date.parse(credentials.access_token_expires_at);
  if (credentials.access_token
    && Number.isFinite(expiresAt)
    && expiresAt > deps.now() + SHOPIFY_TOKEN_REFRESH_MARGIN_MS) {
    return { accessToken: credentials.access_token, credentials };
  }

  const renewed = await deps.requestToken({
    shopDomain: credentials.shop_domain,
    clientId: credentials.client_id,
    clientSecret: credentials.client_secret,
    now: deps.now(),
  });
  await deps.cacheToken(connectionId, renewed);
  return {
    accessToken: renewed.accessToken,
    credentials: {
      ...credentials,
      access_token: renewed.accessToken,
      access_token_expires_at: renewed.expiresAt,
      granted_scopes: renewed.scopes,
    },
  };
}

export async function getShopifyBackendCredentialsByDomain(shopDomain: string): Promise<ShopifyBackendCredentials | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_shopify_backend_credentials_by_domain", { p_shop_domain: shopDomain });
  if (error) {
    console.error("Connexion Shopify introuvable", { code: error.code, shop_domain: shopDomain });
    return null;
  }
  return parseBackendCredentials(data);
}
