import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ShopifyConnectionStatus } from "./types";

function isStatus(value: unknown): value is ShopifyConnectionStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.shop_domain === "string"
    && typeof row.shop_name === "string"
    && typeof row.shop_currency === "string"
    && typeof row.client_id_hint === "string"
    && Array.isArray(row.granted_scopes)
    && typeof row.webhook_count === "number"
    && typeof row.expected_webhook_count === "number";
}

export async function getShopifyConnectionStatus(businessId: string): Promise<ShopifyConnectionStatus | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_shopify_connection_status", { p_business_id: businessId });
  if (error) {
    console.error("Statut Shopify indisponible", { code: error.code });
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  return isStatus(row) ? row : null;
}
