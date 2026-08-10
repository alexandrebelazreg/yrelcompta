export const SHOPIFY_API_VERSION = "2026-07";
export const SHOPIFY_REQUIRED_SCOPES = ["read_orders", "read_products"] as const;
export const SHOPIFY_WEBHOOK_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_PAID",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
] as const;

export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

export const SHOPIFY_WEBHOOK_PATH = "/api/integrations/shopify/webhook";
export const SHOPIFY_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
