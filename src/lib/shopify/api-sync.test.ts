import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shopifyRecentQuery, shopifySyncedThrough, shopifySyncSince } from "./orders";
import { signShopifySync, verifyShopifySyncSignature } from "./sync-signature";

const NOW = Date.parse("2026-11-14T12:00:00Z");

describe("signature de la tâche planifiée", () => {
  it("accepte un appel signé récent avec la bonne clé", () => {
    expect(verifyShopifySyncSignature(signShopifySync("sb_secret_test", NOW), "sb_secret_test", NOW + 60_000)).toBe(true);
  });

  it("refuse une signature expirée, falsifiée, sans clé ou avec une autre clé", () => {
    const header = signShopifySync("sb_secret_test", NOW);
    expect(verifyShopifySyncSignature(header, "sb_secret_test", NOW + 6 * 60_000)).toBe(false);
    expect(verifyShopifySyncSignature(header.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "sb_secret_test", NOW)).toBe(false);
    expect(verifyShopifySyncSignature(header, "autre_cle", NOW)).toBe(false);
    expect(verifyShopifySyncSignature(header, undefined, NOW)).toBe(false);
    expect(verifyShopifySyncSignature(null, "sb_secret_test", NOW)).toBe(false);
    expect(verifyShopifySyncSignature("t=abc,v1=xyz", "sb_secret_test", NOW)).toBe(false);
  });

  it("ne transmet jamais la clé elle-même", () => {
    expect(signShopifySync("sb_secret_test", NOW)).not.toContain("sb_secret_test");
  });
});

describe("fenêtre de synchronisation", () => {
  it("reprend dix minutes avant la dernière commande importée", () => {
    expect(shopifySyncSince("2026-11-14T11:30:00Z", NOW)).toBe("2026-11-14T11:20:00.000Z");
  });

  it("couvre les deux derniers jours lors de la première synchronisation", () => {
    expect(shopifySyncSince(null, NOW)).toBe("2026-11-12T12:00:00.000Z");
  });

  it("construit la recherche des commandes modifiées", () => {
    expect(shopifyRecentQuery("2026-11-14T11:20:00.000Z")).toBe("updated_at:>='2026-11-14T11:20:00.000Z'");
    expect(() => shopifyRecentQuery("hier")).toThrow();
  });

  it("n’avance pas au-delà d’une commande en échec, pour la relire au prochain passage", () => {
    expect(shopifySyncedThrough([
      { updatedAt: "2026-11-14T10:00:00Z", ok: true },
      { updatedAt: "2026-11-14T10:05:00Z", ok: true },
      { updatedAt: "2026-11-14T10:10:00Z", ok: false },
      { updatedAt: "2026-11-14T10:15:00Z", ok: true },
    ])).toBe("2026-11-14T10:05:00Z");
    expect(shopifySyncedThrough([])).toBeNull();
    expect(shopifySyncedThrough([{ updatedAt: "2026-11-14T10:00:00Z", ok: false }])).toBeNull();
  });
});

describe("migration et route de synchronisation", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261114120000_shopify_api_sync.sql"), "utf8").replace(/\s+/g, " ");
  const route = readFileSync(join(process.cwd(), "src/app/api/integrations/shopify/sync/route.ts"), "utf8");
  const scheduled = readFileSync(join(process.cwd(), "netlify/functions/shopify-sync.mts"), "utf8");

  it("réserve les fonctions de synchronisation au serveur et ne change aucune signature existante", () => {
    expect(migration).toContain("revoke all on function public.list_shopify_sync_connections(), public.mark_shopify_orders_synced(uuid, timestamptz, text), public.record_shopify_webhook_error(uuid, uuid, text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_shopify_sync_status(uuid) to authenticated");
    expect(migration).toContain("public.is_business_member(p_business_id)");
    expect(migration).not.toMatch(/drop function|create or replace function/i);
  });

  it("n’accepte que les appels signés et planifie un passage toutes les 15 minutes", () => {
    expect(route).toContain("verifyShopifySyncSignature(request.headers.get(SHOPIFY_SYNC_SIGNATURE_HEADER), process.env.SUPABASE_SECRET_KEY)");
    expect(route.indexOf("verifyShopifySyncSignature")).toBeLessThan(route.indexOf("syncAllShopifyConnections()"));
    expect(scheduled).toContain('schedule: "*/15 * * * *"');
    expect(scheduled).toContain("signShopifySync(secret)");
  });
});
