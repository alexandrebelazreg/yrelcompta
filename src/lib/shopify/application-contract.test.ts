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
    expect(route).toContain("request.arrayBuffer()");
    expect(route.indexOf("verifyShopifyWebhookHmac")).toBeLessThan(route.indexOf("JSON.parse"));
  });

  it("ne transmet ni secret ni token dans l’état UI", () => {
    expect(ui).not.toContain("access_token");
    expect(ui).not.toContain("client_secret_vault_id");
    expect(ui).not.toContain("access_token_vault_id");
    expect(ui).toContain('type="password"');
    expect(ui).not.toMatch(/defaultValue=\{[^}]*clientSecret/i);
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
