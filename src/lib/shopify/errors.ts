export type ShopifyErrorCode =
  | "SHOP_DOMAIN_INVALID"
  | "CLIENT_ID_INVALID"
  | "CLIENT_SECRET_INVALID"
  | "SHOPIFY_CREDENTIALS_REJECTED"
  | "SHOP_NOT_PERMITTED"
  | "SHOPIFY_UNAVAILABLE"
  | "SHOPIFY_RESPONSE_INVALID"
  | "SHOPIFY_GRAPHQL_ERROR"
  | "SHOPIFY_SHOP_NOT_FOUND"
  | "SHOP_DOMAIN_MISMATCH"
  | "SHOP_DOMAIN_ALREADY_CONNECTED"
  | "SHOP_DOMAIN_CHANGE_REQUIRES_DISCONNECT"
  | "SHOP_CURRENCY_UNSUPPORTED"
  | "SHOPIFY_SCOPE_READ_ORDERS_MISSING"
  | "SHOPIFY_SCOPE_READ_PRODUCTS_MISSING"
  | "SITE_URL_INVALID"
  | "SUPABASE_ADMIN_NOT_CONFIGURED"
  | "SHOPIFY_CONNECTION_NOT_FOUND"
  | "SHOPIFY_WEBHOOKS_PARTIAL"
  | "SHOPIFY_WEBHOOK_INVALID";

export class ShopifyError extends Error {
  constructor(public readonly code: ShopifyErrorCode, public readonly httpStatus?: number) {
    super(code);
    this.name = "ShopifyError";
  }
}

const frenchMessages: Record<ShopifyErrorCode, string> = {
  SHOP_DOMAIN_INVALID: "Le domaine Shopify est invalide.",
  CLIENT_ID_INVALID: "Le Client ID Shopify est invalide.",
  CLIENT_SECRET_INVALID: "Le Client Secret Shopify est absent ou invalide.",
  SHOPIFY_CREDENTIALS_REJECTED: "Les identifiants Shopify ont été refusés.",
  SHOP_NOT_PERMITTED: "Cette boutique ou cette app n’appartient pas à la même organisation Shopify.",
  SHOPIFY_UNAVAILABLE: "Shopify est momentanément indisponible.",
  SHOPIFY_RESPONSE_INVALID: "Shopify a renvoyé une réponse inattendue.",
  SHOPIFY_GRAPHQL_ERROR: "Shopify a refusé la vérification de la boutique.",
  SHOPIFY_SHOP_NOT_FOUND: "La boutique Shopify est introuvable ou l’app n’y est pas installée.",
  SHOP_DOMAIN_MISMATCH: "La boutique retournée par Shopify ne correspond pas au domaine demandé.",
  SHOP_DOMAIN_ALREADY_CONNECTED: "Cette boutique Shopify est déjà reliée à une autre entreprise YrelCompta.",
  SHOP_DOMAIN_CHANGE_REQUIRES_DISCONNECT: "Pour connecter une autre boutique, déconnectez d’abord la boutique actuelle.",
  SHOP_CURRENCY_UNSUPPORTED: "Seules les boutiques Shopify en EUR sont prises en charge dans cette version.",
  SHOPIFY_SCOPE_READ_ORDERS_MISSING: "La permission Shopify read_orders est manquante.",
  SHOPIFY_SCOPE_READ_PRODUCTS_MISSING: "La permission Shopify read_products est manquante.",
  SITE_URL_INVALID: "NEXT_PUBLIC_SITE_URL est invalide pour les webhooks Shopify.",
  SUPABASE_ADMIN_NOT_CONFIGURED: "La configuration serveur Supabase est manquante.",
  SHOPIFY_CONNECTION_NOT_FOUND: "Aucune connexion Shopify n’est disponible.",
  SHOPIFY_WEBHOOKS_PARTIAL: "Les webhooks Shopify ne sont que partiellement configurés.",
  SHOPIFY_WEBHOOK_INVALID: "Le webhook Shopify est invalide.",
};

export function shopifyErrorMessage(error: unknown): string {
  if (error instanceof ShopifyError) return frenchMessages[error.code];
  if (error instanceof Error && error.message === "SUPABASE_ADMIN_NOT_CONFIGURED") {
    return frenchMessages.SUPABASE_ADMIN_NOT_CONFIGURED;
  }
  return "La connexion Shopify n’a pas pu être finalisée.";
}

export function shopifyErrorCode(error: unknown): ShopifyErrorCode {
  if (error instanceof ShopifyError) return error.code;
  if (error instanceof Error && error.message === "SUPABASE_ADMIN_NOT_CONFIGURED") {
    return "SUPABASE_ADMIN_NOT_CONFIGURED";
  }
  return "SHOPIFY_UNAVAILABLE";
}
