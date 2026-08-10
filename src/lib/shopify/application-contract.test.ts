import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const route = read("src/app/api/integrations/shopify/webhook/route.ts");
const admin = read("src/lib/supabase/admin.ts");
const actions = read("src/lib/shopify/actions.ts");
const page = read("src/app/(app)/parametres/shopify/page.tsx");
const ui = read("src/components/shopify/shopify-settings.tsx");
const env = read(".env.example");

describe("contrats de sécurité Shopify côté application", () => {
  it("conserve la clé Supabase privilégiée exclusivement côté serveur", () => {
    expect(admin).toContain('import "server-only"');
    expect(admin).toContain("process.env.SUPABASE_SECRET_KEY");
    expect(admin).toContain('secretKey.startsWith("sb_secret_")');
    expect(env).toContain("SUPABASE_SECRET_KEY=");
    expect(env).not.toContain("NEXT_PUBLIC_SUPABASE_SECRET_KEY");
    expect(actions).not.toContain("NEXT_PUBLIC_SUPABASE_SECRET_KEY");
    expect(page).not.toContain("SUPABASE_SECRET_KEY");
    expect(ui).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("compile le webhook en runtime Node et vérifie le body avant JSON.parse", () => {
    expect(route).toContain('export const runtime = "nodejs"');
    expect(route).toContain('request.headers.get("content-length")');
    expect(route).toContain("request.body.getReader()");
    expect(route).toContain("totalBytes > MAX_WEBHOOK_BYTES");
    expect(route).not.toContain("request.arrayBuffer()");
    expect(route.indexOf("verifyShopifyWebhookHmacWithRotation")).toBeLessThan(route.indexOf("JSON.parse"));
  });

  it("fait exécuter les mutations Shopify par le client admin avec l’acteur authentifié", () => {
    expect(actions).not.toContain('import { createClient } from "@/lib/supabase/server"');
    expect(actions).toContain("const { userId, context } = await getAuthenticatedContext()");
    expect(actions.match(/createAdminClient\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(actions.match(/p_actor: context\.userId/g)?.length).toBe(6);
    for (const rpc of ["upsert_shopify_connection", "replace_shopify_webhook_subscriptions", "mark_shopify_connection_verified", "disconnect_shopify_connection"]) {
      expect(actions).toContain(`admin.rpc("${rpc}"`);
    }
  });

  it("marque tout échec de réconciliation comme partiel", () => {
    expect(actions).toContain('admin.rpc("mark_shopify_webhooks_partial"');
    expect(actions).toContain('p_error_code: "SHOPIFY_WEBHOOKS_PARTIAL"');
    expect(actions).toContain("onPartialFailure: () => markShopifyWebhooksPartial(context, data)");
    expect(actions.match(/await markShopifyWebhooksPartial\(context, status\.id\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(ui).toContain('status.connection_status === "connected" && status.webhook_count === status.expected_webhook_count');
  });

  it("relit les webhooks live avant de supprimer la connexion locale", () => {
    const liveCleanup = actions.indexOf("await deleteYrelComptaWebhooks");
    const localDisconnect = actions.indexOf('admin.rpc("disconnect_shopify_connection"');
    expect(liveCleanup).toBeGreaterThan(0);
    expect(localDisconnect).toBeGreaterThan(liveCleanup);
    expect(actions).toContain("knownSubscriptionIds: subscriptionIds");
    expect(actions).toContain("webhookUrl: getShopifyWebhookUrl()");
  });

  it("ne transmet ni secret ni token dans l’état UI", () => {
    expect(ui).not.toContain("access_token");
    expect(ui).not.toContain("client_secret_vault_id");
    expect(ui).not.toContain("access_token_vault_id");
    expect(ui).toContain('type="password"');
    expect(ui).not.toMatch(/defaultValue=\{[^}]*clientSecret/i);
  });

  it("rend la boutique immuable pendant un remplacement d’identifiants", () => {
    expect(ui).toContain('id="replacementShopDomain" value={shopDomain} readOnly');
    expect(ui).toContain('<input type="hidden" name="shopDomain" value={shopDomain}/>');
    expect(actions).toContain("SHOP_DOMAIN_CHANGE_REQUIRES_DISCONNECT");
  });

  it("ne persiste que le hash et des identifiants minimaux du webhook", () => {
    expect(route).toContain("p_payload_sha256: hashShopifyWebhookPayload(rawBody)");
    expect(route).not.toContain("p_payload:");
    expect(route).not.toContain("JSON.stringify(payload)");
  });

  it("n’appelle aucune RPC comptable depuis le webhook", () => {
    for (const rpc of ["create_sale_draft", "update_sale_draft", "validate_sale", "record_payment", "record_refund", "cancel_sale"]) {
      expect(route).not.toContain(rpc);
    }
  });

  it("n’utilise jamais le token dans cookies ou stockages navigateur", () => {
    for (const source of [route, actions, page, ui]) {
      expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/i);
    }
  });
});
