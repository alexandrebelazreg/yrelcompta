import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260810180000_shopify_connection_foundation.sql"),
  "utf8",
);
const sql = migration.replace(/\s+/g, " ").trim();
const section = (start: string, end: string) => migration.slice(migration.indexOf(start), migration.indexOf(end));

describe("migration Shopify sécurisée", () => {
  it("active Vault et ne persiste jamais les secrets en clair", () => {
    const connectionTable = section("create table public.shopify_connections", "create table public.shopify_webhook_subscriptions");
    expect(sql).toContain("create extension if not exists supabase_vault with schema vault");
    expect(sql).toContain("vault.create_secret");
    expect(sql).toContain("vault.update_secret");
    expect(sql).toContain("client_secret_vault_id uuid not null");
    expect(sql).toContain("access_token_vault_id uuid not null");
    expect(connectionTable).not.toMatch(/client_secret\s+text/i);
    expect(connectionTable).not.toMatch(/access_token\s+text/i);
  });

  it("crée les trois tables Shopify isolées par business", () => {
    expect(sql).toContain("create table public.shopify_connections");
    expect(sql).toContain("create table public.shopify_webhook_subscriptions");
    expect(sql).toContain("create table public.shopify_webhook_events");
    expect(sql).toContain("constraint shopify_connections_business_key unique (business_id)");
    expect(sql).toContain("constraint shopify_connections_shop_domain_key unique (shop_domain)");
  });

  it("active RLS et interdit toute lecture directe anon/authenticated", () => {
    for (const table of ["shopify_connections", "shopify_webhook_subscriptions", "shopify_webhook_events"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
    expect(sql).toContain("revoke all on table vault.decrypted_secrets from public, anon, authenticated");
  });

  it("n’expose que le statut nettoyé à authenticated", () => {
    const statusFunction = section("create function public.get_shopify_connection_status", "revoke all on function public.get_shopify_connection_status");
    expect(sql).toContain("create function public.get_shopify_connection_status");
    expect(sql).toContain("'••••' || right(c.client_id, 4)");
    expect(statusFunction).not.toContain("client_secret_vault_id");
    expect(statusFunction).not.toContain("access_token_vault_id");
    expect(sql.match(/grant execute on function public\.[^(]+\([^;]+\) to authenticated/g)).toEqual([
      "grant execute on function public.get_shopify_connection_status(uuid) to authenticated",
    ]);
  });

  it("revérifie p_actor et business_id directement en base", () => {
    const actorCheck = section("create function public.assert_shopify_actor_manager", "revoke all on function public.assert_shopify_actor_manager");
    expect(actorCheck).toContain("from public.business_members");
    expect(actorCheck).toContain("business_id = p_business_id");
    expect(actorCheck).toContain("user_id = p_actor");
    expect(actorCheck).toContain("role in ('owner', 'member')");
    expect(actorCheck).not.toContain("auth.uid()");
    expect(sql.match(/public\.assert_shopify_actor_manager\(p_business_id, p_actor\)/g)?.length).toBe(4);
    expect(sql).toContain("where id = p_connection_id and business_id = p_business_id");
    expect(sql).toContain("where shop_domain = p_shop_domain and business_id <> p_business_id");
  });

  it("réserve toutes les mutations et RPC de secrets à service_role", () => {
    const backendSignatures = [
      "public.assert_shopify_actor_manager(uuid, uuid)",
      "public.upsert_shopify_connection(uuid, uuid, text, text, text, text, timestamptz, text, text, text, text[])",
      "public.replace_shopify_webhook_subscriptions(uuid, uuid, uuid, jsonb)",
      "public.mark_shopify_connection_verified(uuid, uuid, uuid, text[])",
      "public.disconnect_shopify_connection(uuid, uuid, uuid)",
      "public.get_shopify_backend_credentials(uuid)",
      "public.get_shopify_backend_credentials_by_domain(text)",
      "public.get_shopify_backend_webhook_subscriptions(uuid)",
      "public.cache_shopify_access_token(uuid, text, timestamptz, text[])",
      "public.record_shopify_webhook_event(uuid, uuid, text, text, text, text, timestamptz, text, text, text)",
    ];
    for (const signature of backendSignatures) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
    for (const mutation of ["upsert_shopify_connection", "replace_shopify_webhook_subscriptions", "mark_shopify_connection_verified", "disconnect_shopify_connection"]) {
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${mutation}\\([^;]+ to authenticated`));
    }
  });

  it("conserve exactement un secret précédent pendant 65 minutes", () => {
    const upsert = section("create function public.upsert_shopify_connection", "revoke all on function public.upsert_shopify_connection");
    expect(sql).toContain("previous_client_secret_vault_id uuid");
    expect(sql).toContain("previous_client_secret_valid_until timestamptz");
    expect(upsert).toContain("where id = existing.previous_client_secret_vault_id");
    expect(upsert).toContain("previous_client_secret_vault_id = existing.client_secret_vault_id");
    expect(upsert).toContain("previous_client_secret_valid_until = now() + interval '65 minutes'");
    expect(upsert.match(/previous_client_secret_vault_id\s*=/g)).toHaveLength(1);
  });

  it("refuse un changement de boutique avant toute rotation ou modification", () => {
    const upsert = section("create function public.upsert_shopify_connection", "revoke all on function public.upsert_shopify_connection");
    const refusal = upsert.indexOf("SHOP_DOMAIN_CHANGE_REQUIRES_DISCONNECT");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(upsert.indexOf("delete from vault.secrets"));
    expect(refusal).toBeLessThan(upsert.indexOf("vault.create_secret"));
    expect(refusal).toBeLessThan(upsert.indexOf("update public.shopify_connections"));
    expect(upsert).not.toContain("set shop_domain = p_shop_domain");
    expect(upsert).not.toContain("shopify_webhook_subscriptions");
  });

  it("déduplique chaque livraison par connexion et webhook_id", () => {
    expect(sql).toContain("constraint shopify_webhook_events_delivery_key unique (connection_id, webhook_id)");
    expect(sql).toContain("on conflict (connection_id, webhook_id) do nothing");
  });

  it("ne stocke pas le payload Shopify complet", () => {
    expect(sql).toContain("payload_sha256 text not null");
    expect(migration).not.toMatch(/\bpayload\s+(json|jsonb|text|bytea)\b/i);
    expect(migration).not.toMatch(/customer_email|shipping_address|billing_address|customer_name/i);
  });

  it("limite les subscriptions aux cinq topics V1", () => {
    for (const topic of ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"]) {
      expect(migration).toContain(topic);
    }
    expect(migration).not.toContain("write_orders");
    expect(migration).not.toContain("read_all_orders");
  });

  it("supprime current, previous et token lors de la déconnexion sans toucher aux données comptables", () => {
    const disconnect = section("create function public.disconnect_shopify_connection", "revoke all on function public.disconnect_shopify_connection");
    expect(disconnect).toContain("connection.client_secret_vault_id");
    expect(disconnect).toContain("connection.previous_client_secret_vault_id");
    expect(disconnect).toContain("connection.access_token_vault_id");
    for (const table of ["sales", "payments", "refunds", "expenses", "documents"]) {
      expect(migration).not.toMatch(new RegExp(`delete from public\\.${table}\\b`, "i"));
    }
  });
});
