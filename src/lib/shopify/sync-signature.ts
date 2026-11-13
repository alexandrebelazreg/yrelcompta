import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature des appels de la tâche planifiée vers la route de synchronisation Shopify.
 * La clé secrète Supabase, déjà présente côté serveur, ne quitte jamais le serveur :
 * elle sert seulement à calculer un HMAC horodaté, valable cinq minutes.
 * (Module sans alias « @/… » : il est aussi importé par la fonction planifiée Netlify.)
 */
export const SHOPIFY_SYNC_SIGNATURE_HEADER = "x-yrelcompta-signature";
const MAX_AGE_SECONDS = 300;

function digest(secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`yrelcompta-shopify-sync:${timestamp}`).digest("hex");
}

export function signShopifySync(secret: string, now = Date.now()): string {
  const timestamp = Math.floor(now / 1000);
  return `t=${timestamp},v1=${digest(secret, timestamp)}`;
}

export function verifyShopifySyncSignature(header: string | null, secret: string | undefined, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const match = /^t=(\d{9,11}),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(Math.floor(now / 1000) - timestamp) > MAX_AGE_SECONDS) return false;
  const expected = Buffer.from(digest(secret, timestamp), "hex");
  const received = Buffer.from(match[2], "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
