import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20260807120000_registers_declarations.sql";
const migration = readFileSync(join(root, "supabase/migrations", migrationName), "utf8");
const sql = migration.replace(/\s+/g, " ");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const declarationPage = readFileSync(join(root, "src/app/(app)/registres/declarations/page.tsx"), "utf8");
const declarationPresentation = readFileSync(join(root, "src/lib/registers/presentation.ts"), "utf8");

function sqlFunction(name: string, nextMarker: string): string {
  const start = migration.indexOf(`create function public.${name}`);
  return migration.slice(start, migration.indexOf(nextMarker, start));
}

describe("migration registres et déclarations", () => {
  it("précède immédiatement la migration de facturation", () => {
    const migrations = readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
    expect(migrations.filter((name) => name > "20260807010000_sales_product_snapshots.sql")).toEqual([
      migrationName,
      "20260807220000_invoicing_documents.sql",
      "20260808120000_fiscal_social_rules.sql",
    ]);
  });

  it("ajoute la date légale sans utiliser businesses.created_at", () => {
    expect(sql).toContain("alter table public.business_settings add column activity_started_on date");
    expect(migration).not.toContain("businesses.created_at");
  });

  it("crée le schéma complet des déclarations et ses trois statuts de calcul", () => {
    expect(sql).toContain("declaration_calculation_status as enum ( 'available', 'vat-unmodeled', 'refund-review-required' )");
    for (const column of ["period_start date", "period_end date", "due_on date", "declaration_period_snapshot", "vat_regime_snapshot", "revision_no integer", "previous_declaration_id uuid", "suggested_turnover_cents bigint", "gross_receipts_snapshot_cents bigint", "customer_refunds_snapshot_cents bigint", "declared_turnover_cents bigint", "submitted_on date", "created_by uuid", "created_at timestamptz"]) expect(sql).toContain(column);
  });

  it("active RLS en lecture membre et interdit toute écriture directe", () => {
    expect(sql).toContain("alter table public.turnover_declarations enable row level security");
    expect(sql).toContain("grant select on table public.turnover_declarations to authenticated");
    expect(sql).toContain("using (public.is_business_member(business_id))");
    expect(sql).toContain("revoke all on table public.turnover_declarations from anon, authenticated");
    expect(migration).not.toMatch(/create policy turnover_declarations.*for (insert|update|delete|all)/i);
  });

  it("rend UPDATE et DELETE impossibles par trigger", () => {
    expect(sql).toContain("before update or delete on public.turnover_declarations");
    expect(sql).toContain("raise exception 'turnover declaration is immutable'");
  });

  it("impose la chaîne de révisions et l’unicité par période", () => {
    expect(sql).toContain("unique (business_id, period_start, period_end, revision_no)");
    expect(sql).toContain("revision_no = 1 and previous_declaration_id is null");
    expect(sql).toContain("revision_no > 1 and previous_declaration_id is not null");
  });

  it("impose submitted_on strictement après period_end dans le schéma", () => {
    expect(sql).toContain("constraint turnover_declarations_submitted_after_period check (submitted_on > period_end)");
  });

  it("contrôle la date d’activité par owner et la verrouille après une déclaration", () => {
    const fn = sqlFunction("set_business_activity_started_on", "revoke all on function public.set_business_activity_started_on");
    expect(fn).toContain("auth.uid()");
    expect(fn).toContain("public.is_business_owner(p_business_id)");
    expect(fn).toContain("p_activity_started_on > today_paris");
    expect(fn).toContain("exists (select 1 from public.turnover_declarations");
  });

  it("calcule les premières périodes mensuelle et trimestrielle sans calendrier férié", () => {
    const fn = sqlFunction("get_declaration_period_details", "revoke all on function public.get_declaration_period_details");
    expect(fn).toContain("interval '4 months - 1 day'");
    expect(fn).toContain("interval '6 months - 1 day'");
    expect(fn).toContain("interval '2 months - 1 day'");
  });

  it("recalcule les snapshots depuis les encaissements bruts et sépare les remboursements", () => {
    const fn = sqlFunction("record_turnover_declaration", "create function public.revise_turnover_declaration");
    expect(fn).toContain("sum(gross_amount_cents)");
    expect(fn).toContain("from public.payments");
    expect(fn).toContain("from public.refunds");
    expect(fn).not.toContain("net_deposit_cents");
    expect(fn).not.toContain("platform_fee_cents");
    expect(fn).not.toContain("public.expenses");
  });

  it("applique les garde-fous remboursement puis TVA et conserve zéro comme suggestion", () => {
    const fn = sqlFunction("record_turnover_declaration", "create function public.revise_turnover_declaration");
    expect(fn.indexOf("if refund_count > 0")).toBeLessThan(fn.indexOf("settings.vat_regime = 'liable'"));
    expect(fn).toContain("calc_status := 'available'; suggested := gross_receipts");
    expect(fn).toContain("coalesce(sum(gross_amount_cents), 0)");
  });

  it("crée la première révision sans précédent", () => {
    const fn = sqlFunction("record_turnover_declaration", "create function public.revise_turnover_declaration");
    expect(fn).toContain("1, null, calc_status, suggested");
    expect(fn).toContain("'recorded', 'turnover_declaration'");
  });

  it("refuse une date de déclaration antérieure ou égale dans la RPC initiale", () => {
    const fn = sqlFunction("record_turnover_declaration", "create function public.revise_turnover_declaration");
    expect(fn).toContain("if p_submitted_on <= p_period_end then raise exception 'declaration submitted before period end'");
  });

  it("verrouille la dernière révision et insère la correction suivante", () => {
    const fn = sqlFunction("revise_turnover_declaration", "revoke all on function public.record_turnover_declaration");
    expect(fn).toContain("order by revision_no desc");
    expect(fn).toContain("for update");
    expect(fn).toContain("previous.revision_no + 1, previous.id");
    expect(fn).toContain("if reason is null then raise exception 'correction reason required'");
    expect(fn).not.toMatch(/update public\.turnover_declarations/i);
  });

  it("refuse une date de déclaration antérieure ou égale dans la RPC de correction", () => {
    const fn = sqlFunction("revise_turnover_declaration", "revoke all on function public.record_turnover_declaration");
    expect(fn).toContain("if p_submitted_on <= p_period_end then raise exception 'declaration submitted before period end'");
  });

  it("audite uniquement période et révision, sans montants sensibles", () => {
    const auditLines = migration.split("\n").filter((line) => line.includes("jsonb_build_object('period_start'"));
    expect(auditLines).toHaveLength(2);
    expect(auditLines.join(" ")).not.toContain("declared_turnover_cents");
  });

  it("sécurise toutes les RPC avec auth, business, search_path et grants ciblés", () => {
    expect(migration.match(/security definer/g)).toHaveLength(3);
    expect(migration.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("grant execute on function public.record_turnover_declaration");
    expect(sql).toContain("grant execute on function public.revise_turnover_declaration");
    expect(migration).not.toContain("service_role");
  });

  it("ne contient aucune commande d’application Supabase", () => {
    expect(packageJson).not.toContain("supabase db push");
    expect(migration).not.toMatch(/migration repair|db push/i);
  });

  it("ne prétend jamais transmettre automatiquement à l’Urssaf", () => {
    expect(declarationPage).not.toContain("déclaration envoyée à l’Urssaf");
    expect(declarationPage).toContain("Cette action n’envoie rien à l’Urssaf");
    expect(declarationPresentation).toContain("Déclaration enregistrée dans YrelCompta");
  });
});
