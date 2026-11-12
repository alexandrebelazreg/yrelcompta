import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261112120000_audit_oauth_client.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");

describe("migration de traçabilité des applications connectées", () => {
  it("recopie le client OAuth du jeton dans le journal d’audit", () => {
    expect(sql).toContain("alter table public.audit_logs add column oauth_client_id text");
    expect(sql).toContain("auth.jwt() ->> 'client_id'");
    expect(sql).toContain("before insert on public.audit_logs for each row");
  });

  it("ne change aucune RPC et n’ouvre aucun droit", () => {
    expect(migration).not.toMatch(/drop function|grant |create policy/i);
    expect(sql).toContain("revoke all on function public.audit_logs_set_oauth_client() from public,anon,authenticated");
    expect(migration).not.toContain("service_role");
  });
});
