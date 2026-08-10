import type { ShopifyWebhookTopic } from "./constants";

export interface ShopifyToken {
  accessToken: string;
  scopes: string[];
  expiresAt: string;
}

export interface ShopifyShop {
  id: string;
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
}

export interface ShopifyBackendCredentials {
  connection_id: string;
  business_id: string;
  shop_domain: string;
  client_id: string;
  client_secret: string;
  access_token: string;
  access_token_expires_at: string;
  granted_scopes: string[];
}

export interface ShopifyConnectionStatus {
  id: string;
  shop_domain: string;
  shop_name: string;
  shop_currency: string;
  client_id_hint: string;
  connection_status: "webhooks_partial" | "connected" | "error";
  granted_scopes: string[];
  last_verified_at: string | null;
  webhook_count: number;
  expected_webhook_count: number;
}

export interface ShopifyWebhookSubscription {
  topic: ShopifyWebhookTopic;
  shopify_subscription_gid: string;
  uri: string;
}
