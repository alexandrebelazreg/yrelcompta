import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "supabase/migrations/20260810120000_recurring_expense_automation.sql");
const migration = readFileSync(migrationPath, "utf8");
const sql = migration.replace(/\s+/g, " ").trim();
const actions = readFileSync(join(process.cwd(), "src/lib/expenses/actions.ts"), "utf8");
const recurringPage = readFileSync(join(process.cwd(), "src/app/(app)/depenses/recurrences/page.tsx"), "utf8");

describe("migration d’automatisation des charges récurrentes", () => {
  it("crée un brouillon pour chaque modèle automatique dû", () => {
    expect(sql).toContain("where is_active = true and auto_generate = true and next_due_on <= run_date");
    expect(sql).toContain("template.notes, 'draft', p_actor, p_template_id, occurrence_due_on");
  });

  it("ignore les modèles non dus", () => {
    expect(sql).toContain("or current_due_on > run_date");
  });

  it("ignore les modèles dont la génération automatique est désactivée", () => {
    expect(sql).toContain("add column auto_generate boolean not null default true");
    expect(sql).toContain("and auto_generate = true");
    expect(sql).toContain("if p_source = 'recurring_auto' and not template.auto_generate then");
  });

  it("ignore les modèles archivés", () => {
    expect(sql).toContain("where is_active = true");
    expect(sql).toContain("if not template.is_active then");
  });

  it("avance les fréquences mensuelles, trimestrielles et annuelles comme le moteur existant", () => {
    expect(sql).toContain("when 'monthly' then (occurrence_due_on + interval '1 month')::date");
    expect(sql).toContain("when 'quarterly' then (occurrence_due_on + interval '3 months')::date");
    expect(sql).toContain("else (occurrence_due_on + interval '1 year')::date");
  });

  it("rattrape plusieurs échéances avec une limite défensive de 24 par modèle", () => {
    expect(sql).toContain("while generated_for_template < 24 loop");
    expect(sql).toContain("next_due_on = calculated_next_due_on");
  });

  it("rend une occurrence unique et idempotente en base", () => {
    expect(sql).toContain("create unique index expenses_recurring_occurrence_key on public.expenses(business_id, recurring_template_id, recurring_due_on) where recurring_template_id is not null");
    expect(sql).toContain("on conflict (business_id, recurring_template_id, recurring_due_on) where recurring_template_id is not null do nothing");
  });

  it("résiste aux workers concurrents par verrouillage", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("where id = p_template_id and business_id = p_business_id for update");
  });

  it("renseigne le modèle et la date d’occurrence sur la dépense", () => {
    expect(sql).toContain("recurring_template_id uuid");
    expect(sql).toContain("recurring_due_on date");
    expect(sql).toContain("p_template_id, occurrence_due_on");
  });

  it("ne valide jamais automatiquement la dépense", () => {
    expect(sql).toContain("template.notes, 'draft', p_actor");
    expect(migration).not.toMatch(/perform\s+public\.validate_expense/i);
  });

  it("isole chaque génération par business_id et par clé étrangère composite", () => {
    expect(sql).toContain("foreign key (recurring_template_id, business_id) references public.recurring_expense_templates(id, business_id)");
    expect(sql).toContain("where id = p_template_id and business_id = p_business_id");
    expect(sql).toContain("public.assert_expense_manager(p_business_id)");
  });

  it("interdit les fonctions internes à authenticated", () => {
    expect(sql).toContain("revoke all on function public.generate_recurring_expense_occurrence(uuid, uuid, text, uuid, date, date) from authenticated");
    expect(sql).toContain("revoke all on function public.generate_due_recurring_expenses() from authenticated");
    expect(sql).not.toContain("grant execute on function public.generate_due_recurring_expenses() to authenticated");
  });

  it("expose la nouvelle RPC manuelle contrôlée tout en conservant la surcharge historique", () => {
    expect(sql).toContain("create or replace function public.create_expense_from_recurring_template");
    expect(sql).toContain("p_purchased_on date, p_recurring_due_on date");
    expect(sql).toContain("'recurring_manual', actor, p_purchased_on, p_recurring_due_on");
    expect(sql).toContain("grant execute on function public.create_expense_from_recurring_template(uuid, uuid, date) to authenticated");
    expect(sql).toContain("grant execute on function public.create_expense_from_recurring_template(uuid, uuid, date, date) to authenticated");
    expect(sql).toContain("actor uuid := public.assert_expense_manager(p_business_id)");
  });

  it("transmet séparément l’échéance canonique et la date d’achat modifiable", () => {
    expect(recurringPage).toContain('name="recurringDueOn" value={template.next_due_on}');
    expect(recurringPage).toContain('name="purchasedOn" type="date" defaultValue={today} required');
    expect(actions).toContain('value(f,"recurringDueOn")');
    expect(actions).toContain("p_purchased_on:purchased.data,p_recurring_due_on:recurringDue.data");
  });

  it("identifie une occurrence uniquement par business, modèle et échéance", () => {
    expect(sql).toContain("and recurring_template_id = p_template_id and recurring_due_on = occurrence_due_on");
    expect(sql).not.toContain("and purchased_on = p_purchased_on");
  });

  it("retourne l’occurrence exacte après une double soumission sans avancer à nouveau", () => {
    expect(sql).toContain("if occurrence_due_on is distinct from template.next_due_on then select id into expense_id");
    expect(sql).toContain("if expense_id is not null then return expense_id; end if; raise exception 'recurring occurrence is stale'");
    expect(sql).toContain("and next_due_on = occurrence_due_on");
  });

  it("refuse explicitement une occurrence obsolète absente", () => {
    expect(sql).toContain("raise exception 'recurring occurrence is stale' using errcode = '55000'");
    expect(actions).toContain("Cette échéance a changé. Actualisez la page avant de générer le brouillon.");
  });

  it("autorise deux échéances distinctes avec la même date d’achat", () => {
    expect(sql).toContain("create unique index expenses_recurring_occurrence_key on public.expenses(business_id, recurring_template_id, recurring_due_on)");
    expect(sql).not.toMatch(/unique[^;]+purchased_on/i);
  });

  it("journalise explicitement la génération automatique sans faux utilisateur", () => {
    expect(sql).toContain("'source', p_source, 'expense_id', expense_id, 'recurring_due_on', occurrence_due_on");
    expect(sql).toContain("'recurring_auto', null, current_due_on, current_due_on");
  });

  it("protège les champs de récurrence des dépenses validées", () => {
    expect(sql).toContain("new.recurring_template_id is distinct from old.recurring_template_id");
    expect(sql).toContain("new.recurring_due_on is distinct from old.recurring_due_on");
    expect(sql).toContain("raise exception 'expense is immutable'");
  });

  it("active pg_cron et planifie un unique job quotidien interne", () => {
    expect(sql).toContain("create extension if not exists pg_cron");
    expect(sql).toContain("'yrelcompta-generate-recurring-expenses', '15 4 * * *', 'select public.generate_due_recurring_expenses();'");
    expect(migration.match(/yrelcompta-generate-recurring-expenses/g)).toHaveLength(1);
    expect(migration).not.toMatch(/http|net\./i);
  });

  it("calcule le jour métier en Europe/Paris", () => {
    expect(sql).toContain("(now() at time zone 'Europe/Paris')::date");
  });

  it("laisse la suppression des brouillons au mécanisme existant sans reculer le calendrier", () => {
    expect(migration).not.toContain("create or replace function public.delete_expense_draft");
    expect(migration).not.toMatch(/set\s+next_due_on\s*=.*recurring_due_on/i);
  });
});
