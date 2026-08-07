import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20260807220000_invoicing_documents.sql";
const migration = readFileSync(join(root, "supabase/migrations", migrationName), "utf8");
const salesMigration = readFileSync(join(root, "supabase/migrations/20260805010000_sales_payments.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");
function fn(name: string, next: string): string { const start = migration.indexOf(`${name}(`); return migration.slice(start, migration.indexOf(next, start)); }
const settingsFn = fn("public.save_invoice_settings", "create function public.issue_invoice");
const invoiceFn = fn("public.issue_invoice", "create function public.issue_credit_note");
const creditFn = fn("public.issue_credit_note", "create or replace function public.cancel_sale");
const cancelFn = fn("public.cancel_sale", "revoke all on function public.save_invoice_settings");

describe("migration de facturation", () => {
  it("est l’unique migration postérieure aux registres", () => expect(readdirSync(join(root, "supabase/migrations")).filter((name) => name > "20260807120000_registers_declarations.sql").sort()).toEqual([migrationName]));
  it("crée les trois enums métier sans valeur implicite", () => {
    expect(sql).toContain("billing_document_kind as enum ('invoice', 'credit_note')");
    expect(sql).toContain("billing_customer_kind as enum ('individual', 'professional')");
    expect(sql).toContain("billing_operation_category as enum ('goods', 'services', 'mixed')");
  });
  it("crée les paramètres avec identité légale distincte du nom commercial", () => {
    expect(sql).toContain("create table public.invoice_settings");
    expect(sql).toContain("issuer_legal_name text not null"); expect(sql).toContain("issuer_trade_name text");
    expect(settingsFn).not.toContain("businesses.name");
  });
  it("valide strictement le SIRET et les champs requis", () => {
    expect(sql).toContain("issuer_siret ~ '^[0-9]{14}$'");
    expect(sql).toContain("invoice_settings_legal_name"); expect(sql).toContain("invoice_settings_address");
  });
  it("réserve la modification des paramètres au propriétaire", () => {
    expect(settingsFn).toContain("auth.uid()"); expect(settingsFn).toContain("public.is_business_owner(p_business_id)");
    expect(settingsFn).toContain("on conflict (business_id) do update");
  });
  it("audite les paramètres sans recopier les coordonnées", () => {
    const audit = settingsFn.slice(settingsFn.indexOf("insert into public.audit_logs"));
    expect(audit).toContain("invoice_settings_updated");
    expect(audit).not.toMatch(/issuer_address|issuer_email|issuer_phone/);
  });
  it("crée une clé de compteur par entreprise, type et année", () => expect(sql).toContain("primary key (business_id, document_kind, series_year)"));
  it("ajoute la clé composite des remboursements avant la FK du document", () => {
    const unique = "constraint refunds_id_business_sale_key unique (id, business_id, sale_id)";
    const foreignKey = "billing_documents_refund_business_sale_fk foreign key (linked_refund_id, business_id, sale_id) references public.refunds(id, business_id, sale_id)";
    expect(sql).toContain(unique);
    expect(sql).toContain(foreignKey);
    expect(sql.indexOf(unique)).toBeLessThan(sql.indexOf(foreignKey));
    expect(salesMigration).not.toContain("refunds_id_business_sale_key");
  });
  it("n’utilise aucune séquence PostgreSQL", () => expect(migration).not.toMatch(/nextval|create sequence/i));
  it("met à jour le compteur facture dans la transaction d’insertion", () => {
    expect(invoiceFn).toContain("insert into public.billing_number_counters");
    expect(invoiceFn).toContain("do update set last_value");
    expect(invoiceFn.indexOf("billing_number_counters")).toBeLessThan(invoiceFn.indexOf("insert into public.billing_documents"));
  });
  it("génère FAC côté serveur sans paramètre de numéro", () => {
    expect(invoiceFn).toContain("document_number := 'FAC-'");
    expect(invoiceFn.slice(0, invoiceFn.indexOf("returns uuid"))).not.toMatch(/p_number/);
  });
  it("utilise une série AV indépendante", () => {
    expect(creditFn).toContain("values (p_business_id, 'credit_note'");
    expect(creditFn).toContain("document_number := 'AV-'");
  });
  it("redémarre conceptuellement par année et business grâce à la clé de conflit", () => {
    expect(invoiceFn).toContain("extract(year from today_paris)");
    expect(invoiceFn).toContain("on conflict (business_id, document_kind, series_year)");
  });
  it("garantit l’unicité des numéros et d’une facture par vente", () => {
    expect(sql).toContain("unique (business_id, number)");
    expect(sql).toContain("billing_documents_one_invoice_per_sale_idx");
  });
  it("refuse les ventes brouillon ou annulées", () => expect(invoiceFn).toContain("if sale_row.status <> 'validated'"));
  it("génère issued_on côté serveur à Paris", () => {
    expect(invoiceFn).toContain("now() at time zone 'Europe/Paris'");
    expect(invoiceFn.slice(0, invoiceFn.indexOf("returns uuid"))).not.toContain("p_issued_on");
  });
  it("refuse une date de livraison future et une échéance antérieure", () => {
    expect(invoiceFn).toContain("p_supply_on > today_paris"); expect(invoiceFn).toContain("p_payment_due_on < today_paris");
  });
  it("bloque tout régime TVA autre que franchise avec un code stable", () => {
    expect(invoiceFn).toContain("business_row.vat_regime <> 'franchise'"); expect(invoiceFn).toContain("VAT_INVOICING_NOT_SUPPORTED");
  });
  it("ne code aucun taux de TVA", () => expect(migration).not.toMatch(/(5[,.]5|10[,.]0|20[,.]0|0[,.]2|20\s*%)/));
  it("snapshotte la mention de franchise et impose TVA zéro", () => {
    expect(invoiceFn).toContain("settings_row.vat_exemption_mention");
    expect(invoiceFn).toContain("sale_row.total_cents, 0, sale_row.total_cents");
  });
  it("snapshotte l’identité vendeur et dérive le SIREN du SIRET", () => {
    expect(invoiceFn).toContain("substring(settings_row.issuer_siret from 1 for 9)");
    expect(sql).toContain("issuer_siren_snapshot = substring(issuer_siret_snapshot from 1 for 9)");
  });
  it("snapshotte les données client sans table clients", () => {
    for (const field of ["buyer_name", "buyer_address", "buyer_billing_address", "buyer_delivery_address", "buyer_siren", "purchase_order_reference"]) expect(invoiceFn).toContain(field);
    expect(migration).not.toContain("create table public.customers");
  });
  it("gère l’opposition explicite du particulier et l’adresse du professionnel", () => {
    expect(sql).toContain("buyer_kind = 'professional' and buyer_address_omitted = false");
    expect(sql).toContain("buyer_kind = 'individual' and buyer_address_omitted = true and buyer_address is null");
  });
  it("exige un SIREN à neuf chiffres pour un client professionnel", () => {
    expect(sql).toContain("buyer_kind = 'professional' and buyer_siren is not null and buyer_siren ~ '^[0-9]{9}$'");
    expect(sql).toContain("buyer_kind = 'individual' and (buyer_siren is null or buyer_siren ~ '^[0-9]{9}$')");
    expect(invoiceFn).toContain("PROFESSIONAL_BUYER_SIREN_REQUIRED");
    expect(invoiceFn).toContain("coalesce(p_buyer_siren, '') !~ '^[0-9]{9}$'");
  });
  it("exige les quatre clauses B2B sans calculer de pénalité", () => {
    for (const field of ["default_payment_terms", "default_early_payment_discount_terms", "default_late_penalty_terms", "default_recovery_indemnity_text"]) expect(invoiceFn).toContain(field);
    expect(invoiceFn).not.toMatch(/penalty.*\*|penalty.*\//i);
  });
  it("relit et copie les lignes et montants de vente", () => {
    expect(invoiceFn).toContain("from public.sale_items");
    for (const field of ["sale_row.subtotal_cents", "sale_row.shipping_cents", "sale_row.discount_cents", "sale_row.total_cents"]) expect(invoiceFn).toContain(field);
  });
  it("n’inclut ni commission ni coût ni marge dans l’émission", () => expect(invoiceFn).not.toMatch(/platform_fee|manufacturing|margin|urssaf|expense/));
  it("rend documents et lignes immuables par trigger", () => {
    expect(sql).toContain("billing_documents_immutable before update or delete");
    expect(sql).toContain("billing_document_items_immutable before update or delete");
  });
  it("active RLS et ne donne que SELECT aux membres", () => {
    for (const table of ["invoice_settings", "billing_number_counters", "billing_documents", "billing_document_items"]) expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).not.toMatch(/grant (insert|update|delete|all) on table public\.(invoice_settings|billing_documents|billing_document_items)/i);
    expect(sql).not.toContain("grant select on table public.billing_number_counters");
  });
  it("sécurise toutes les mutations par SECURITY DEFINER et business_id", () => {
    expect(migration.match(/security definer set search_path = ''/g)?.length).toBeGreaterThanOrEqual(4);
    for (const body of [settingsFn, invoiceFn, creditFn, cancelFn]) expect(body).toContain("auth.uid()");
    expect(migration).not.toContain("service_role");
  });
  it("crée un avoir positif relié à la facture et exige un motif", () => {
    expect(creditFn).toContain("p_amount_cents <= 0"); expect(creditFn).toContain("credit reason required");
    expect(creditFn).toContain("original.id, p_linked_refund_id");
  });
  it("plafonne plusieurs avoirs au total original sans modifier la facture", () => {
    expect(creditFn).toContain("coalesce(sum(total_incl_tax_cents), 0)");
    expect(creditFn).toContain("already_credited + p_amount_cents > original.total_incl_tax_cents");
    expect(creditFn).not.toMatch(/update public\.billing_documents/i);
  });
  it("copie les snapshots de l’original dans l’avoir", () => {
    expect(creditFn).toContain("original.issuer_legal_name_snapshot"); expect(creditFn).toContain("original.buyer_name");
    expect(creditFn).not.toContain("public.invoice_settings");
  });
  it("ne crée aucun remboursement lors d’un avoir", () => expect(creditFn).not.toContain("insert into public.refunds"));
  it("contrôle business, vente, unicité et montant du remboursement lié", () => {
    expect(creditFn).toContain("business_id = p_business_id and sale_id = original.sale_id");
    expect(creditFn).toContain("refund_row.amount_cents <> p_amount_cents");
    expect(sql).toContain("billing_documents_linked_refund_unique_idx");
  });
  it("conserve le comportement d’annulation sans facture", () => {
    expect(cancelFn).toContain("existing.status <> 'validated'"); expect(cancelFn).toContain("gross - refunded <> 0");
  });
  it("bloque une vente facturée non totalement créditée", () => {
    expect(cancelFn).toContain("credited <> invoice_row.total_incl_tax_cents");
    expect(cancelFn).toContain("BILLED_SALE_REQUIRES_FULL_CREDIT");
  });
  it("ne contient aucune commande d’application de migration", () => expect(migration).not.toMatch(/supabase db|migration repair/i));
});
