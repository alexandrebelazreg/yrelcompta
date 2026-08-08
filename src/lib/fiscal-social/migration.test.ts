import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20260808120000_fiscal_social_rules.sql";
const migration = readFileSync(join(root, "supabase/migrations", migrationName), "utf8");
const sql = migration.replace(/\s+/g, " ");
const declarationPage = readFileSync(join(root, "src/app/(app)/registres/declarations/page.tsx"), "utf8");
const dashboardPage = readFileSync(join(root, "src/app/(app)/tableau-de-bord/page.tsx"), "utf8");

function functionSql(name: string, nextMarker: string): string {
  const start = migration.indexOf(`${name}(`);
  return migration.slice(start, migration.indexOf(nextMarker, start));
}

describe("migration des règles fiscales et sociales", () => {
  it("est l’unique migration ajoutée après la facturation", () => {
    const migrations = readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
    expect(migrations.filter((name) => name > "20260807220000_invoicing_documents.sql")).toEqual([migrationName]);
  });

  it("crée des règles globales versionnées et les valeurs officielles 2026", () => {
    expect(sql).toContain("create table public.fiscal_social_rule_versions");
    for (const value of ["1230", "10", "30", "100", "7100", "20310000", "8500000", "9350000"]) expect(sql).toContain(value);
    expect(sql).toContain("date '2026-01-01', 'micro_bic_goods'");
  });

  it("versionne les deux régimes ACRE et leur arrondi", () => {
    expect(sql).toContain("create table public.acre_rule_versions");
    expect(sql).toContain("date '0001-01-01', 5000, 3, 10");
    expect(sql).toContain("date '2026-07-01', 7500, 3, 10");
    const theoreticalRate = functionSql("public.theoretical_acre_social_rate", "create function public.get_fiscal_reserve_snapshot");
    expect(theoreticalRate).toContain("p_normal_rate_basis_points::bigint * p_paid_fraction_basis_points + rounding_divisor - 1");
  });

  it("rend les règles et profils immuables et sans écriture authenticated", () => {
    expect(migration.match(/before update or delete/g)).toHaveLength(3);
    for (const table of ["fiscal_social_rule_versions", "acre_rule_versions", "business_fiscal_profiles"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    for (const table of ["fiscal_social_rule_versions", "acre_rule_versions", "business_fiscal_profiles"]) {
      for (const operation of ["insert", "update", "delete", "all"]) expect(sql).not.toContain(`on public.${table} for ${operation}`);
    }
  });

  it("isole la lecture des profils par business et réserve leur création au propriétaire", () => {
    expect(sql).toContain("using (public.is_business_member(business_id))");
    const fn = functionSql("public.create_business_fiscal_profile", "revoke all on function public.create_business_fiscal_profile");
    expect(fn).toContain("public.is_business_owner(p_business_id)");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("first fiscal profile must start with activity");
    expect(fn).toContain("later fiscal profile must start on January 1");
    expect(fn).toContain("later fiscal profile must be future");
    expect(fn).toContain("extract(month from p_effective_from)");
    expect(fn).toContain("extract(day from p_effective_from)");
    expect(fn).not.toContain("pg_catalog.extract");
    expect(fn).toContain("period_end >= p_effective_from");
    expect(fn).toContain("'business_fiscal_profile'");
  });

  it("verrouille la date de début dès la première version fiscale", () => {
    const fn = functionSql("public.set_business_activity_started_on", "create function public.acre_period_end");
    expect(fn).toContain("public.business_fiscal_profiles");
    expect(fn).toContain("activity start locked by declarations or fiscal profiles");
    expect(fn).not.toContain("delete from");
  });

  it("laisse les anciennes déclarations non évaluées et sans reconstruction", () => {
    expect(sql).toContain("add column fiscal_evaluated boolean not null default false");
    expect(sql).toContain("add column fiscal_evaluation_status public.fiscal_evaluation_status not null default 'not-evaluated-historically'");
    expect(sql).toContain("fiscal_evaluated = false and fiscal_evaluation_status <> 'evaluated'");
    expect(migration).not.toMatch(/update public\.turnover_declarations/i);
    expect(declarationPage).toContain("Estimation fiscale non évaluée historiquement");
  });

  it("snapshote les taux et tous les montants sur les nouvelles déclarations", () => {
    for (const column of ["fiscal_profile_id", "fiscal_rule_version_id", "acre_rule_version_id", "social_rate_basis_points_snapshot", "cfp_rate_basis_points_snapshot", "versement_liberatoire_basis_points_snapshot", "acre_applied_snapshot", "estimated_social_contributions_cents", "estimated_cfp_cents", "estimated_income_tax_cents", "estimated_total_reserve_cents"]) expect(sql).toContain(column);
    expect(migration.match(/create or replace function public\.(?:record|revise)_turnover_declaration/g)).toHaveLength(2);
    expect(migration.match(/get_fiscal_reserve_snapshot\(p_business_id, p_period_start, p_period_end, p_declared_turnover_cents\)/g)).toHaveLength(2);
  });

  it("résout les versions au début et refuse une frontière dans la période", () => {
    const snapshot = functionSql("public.get_fiscal_reserve_snapshot", "revoke all on function public.acre_period_end");
    expect(snapshot).toContain("effective_from <= p_period_start");
    expect(snapshot).toContain("effective_from > p_period_start and effective_from <= p_period_end");
    expect(snapshot).toContain("evaluation_status := 'mixed-fiscal-version-period'");
    expect(declarationPage).toContain("cette période traverse un changement de règle ou de configuration");
  });

  it("rend une période ACRE non évaluée sans aucun snapshot partiel", () => {
    const snapshot = functionSql("public.get_fiscal_reserve_snapshot", "revoke all on function public.acre_period_end");
    expect(snapshot).toContain("p_period_start <= acre_ends_on and p_period_end >= settings.activity_started_on");
    expect(snapshot).toContain("evaluation_status := 'acre-cap-unmodeled'");
    expect(snapshot.indexOf("evaluation_status := 'acre-cap-unmodeled'")).toBeLessThan(snapshot.indexOf("fiscal_profile_id := profile.id"));
    expect(declarationPage).toContain("le plafond légal d’exonération n’est pas encore modélisé");
  });

  it("enregistre et révise toujours avec les deux bornes historiques", () => {
    const revise = functionSql("public.revise_turnover_declaration", "comment on table public.fiscal_social_rule_versions");
    expect(revise).toContain("p_period_start, p_period_end, p_declared_turnover_cents");
    expect(revise).toContain("fiscal_snapshot.evaluation_status = 'evaluated'");
    expect(revise).not.toContain("current_date");
    expect(revise).not.toMatch(/update public\.turnover_declarations/i);
  });

  it("affiche la réserve distinctement sans la qualifier de bénéfice ou montant dû", () => {
    expect(dashboardPage).toContain("Réserve fiscale et sociale estimée");
    expect(dashboardPage).toContain("Ce n’est ni un bénéfice net, ni le montant réellement dû");
    expect(dashboardPage).toContain("Gérer les paramètres fiscaux");
  });

  it("ne contient aucune commande Supabase ni service_role", () => {
    expect(migration).not.toMatch(/db push|migration repair|service_role/i);
  });
});
