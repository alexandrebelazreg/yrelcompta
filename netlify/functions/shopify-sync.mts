// Fonction planifiée Netlify : déclenche la synchronisation des commandes Shopify toutes les 15 minutes.
// Elle signe l'appel avec la clé secrète Supabase déjà définie sur le site ; aucune variable à ajouter.
import { SHOPIFY_SYNC_SIGNATURE_HEADER, signShopifySync } from "../../src/lib/shopify/sync-signature";

export default async function shopifySync(): Promise<Response> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  const site = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!secret || !site) {
    console.error("Synchronisation Shopify non configurée : URL du site ou clé serveur absente.");
    return new Response(null, { status: 500 });
  }
  const response = await fetch(new URL("/api/integrations/shopify/sync", site), {
    method: "POST",
    headers: { [SHOPIFY_SYNC_SIGNATURE_HEADER]: signShopifySync(secret) },
  });
  console.log("Synchronisation Shopify", response.status, response.ok ? await response.text() : "");
  return new Response(null, { status: response.ok ? 200 : 502 });
}

export const config = { schedule: "*/15 * * * *" };
