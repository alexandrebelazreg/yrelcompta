import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeRedirect } from "./consent";
import { protectedResourceMetadata, wwwAuthenticate } from "./metadata";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const mcpSources = [
  ...readdirSync(join(root, "src/lib/mcp")).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => `src/lib/mcp/${name}`),
  "src/app/api/mcp/route.ts",
  "src/lib/mcp/write-tools.ts",
  "src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts",
  "src/app/(auth)/oauth/consent/page.tsx",
  "src/app/(app)/parametres/claude/page.tsx",
];

describe("sécurité du connecteur Claude", () => {
  it("n’utilise jamais la clé secrète Supabase", () => {
    for (const path of mcpSources) {
      const source = read(path);
      expect(source, path).not.toContain("SUPABASE_SECRET_KEY");
      expect(source, path).not.toContain("service_role");
      expect(source, path).not.toContain("@/lib/supabase/admin");
    }
  });

  it("n’accepte le jeton que dans l’en-tête Authorization, et seulement s’il a été délivré à un client OAuth", () => {
    const auth = read("src/lib/mcp/auth.ts");
    expect(auth).toContain("readBearerToken(authorization)");
    expect(auth).toContain("claims.client_id");
    expect(read("src/app/api/mcp/route.ts")).toContain('request.headers.get("authorization")');
    expect(read("src/app/api/mcp/route.ts")).not.toContain("searchParams");
  });

  it("exécute les outils avec le client de l’utilisatrice authentifiée", () => {
    expect(read("src/app/api/mcp/route.ts")).toContain("runWithSupabaseClient(auth.session.supabase");
  });

  it("garde les outils de lecture strictement en lecture seule", () => {
    expect(read("src/lib/mcp/tools.ts")).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("limite les écritures aux RPC contrôlées autorisées, sans validation, paiement ni suppression", () => {
    const writes = read("src/lib/mcp/write-tools.ts");
    const rpcs = [...writes.matchAll(/\.rpc\("([a-z_]+)"/g)].map((match) => match[1]);
    expect([...new Set(rpcs)].sort()).toEqual(["create_expense_draft", "create_material", "create_recurring_expense_template", "create_supplier", "save_product_with_recipe", "update_material"]);
    expect(writes).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    expect(writes).not.toMatch(/validate_expense|record_expense|cancel_|archive_|delete_/);
    expect(writes.match(/kind: "write"/g)).toHaveLength(6);
  });

  it("publie des métadonnées qui désignent Supabase Auth", () => {
    expect(protectedResourceMetadata("https://app.example", "https://ref.supabase.co/")).toEqual({
      resource: "https://app.example/api/mcp",
      authorization_servers: ["https://ref.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_name: "YrelCompta",
      resource_documentation: "https://app.example/parametres/claude",
    });
    expect(wwwAuthenticate("https://app.example", "invalid_token", 'Bad "token"')).toBe('Bearer resource_metadata="https://app.example/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="Bad \'token\'"');
  });

  it("signale une application qui ne renvoie pas vers Claude", () => {
    expect(describeRedirect("https://claude.ai/api/mcp/auth_callback")).toEqual({ host: "claude.ai", trusted: true });
    expect(describeRedirect("https://claude.ai.evil.example/callback").trusted).toBe(false);
    expect(describeRedirect("http://claude.ai/callback").trusted).toBe(false);
    expect(describeRedirect("pas une url").trusted).toBe(false);
  });
});
