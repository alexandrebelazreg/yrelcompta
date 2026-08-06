import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260805180000_expenses_documents.sql"),
  "utf8",
);
const sql = migration.replace(/\s+/g, " ");

describe("migration dépenses et justificatifs", () => {
  it("crée un brouillon sans échéance depuis un modèle mensuel en retard", () => {
    expect(sql).toContain(
      "create_expense_draft(p_business_id,p_purchased_on,null,t.supplier_id",
    );
    expect(sql).toContain(
      "when 'monthly' then (t.next_due_on+interval '1 month')::date",
    );
    expect(sql).toContain(
      "last_generated_on=p_purchased_on,next_due_on=nextdate",
    );
  });

  it("applique les arrondis professionnels cumulatifs aux paiements et remboursements", () => {
    expect(sql).toContain(
      "bamt:=(round(((paid::numeric+p_amount_cents::numeric)*e.professional_share_basis_points::numeric)/10000::numeric)-business_paid::numeric)::bigint",
    );
    expect(sql).toContain(
      "bamt:=(round(((refunded::numeric+p_amount_cents::numeric)*p.business_amount_cents::numeric)/p.amount_cents::numeric)-business_refunded::numeric)::bigint",
    );
  });

  it("distingue le nettoyage compensatoire de la suppression d'un document lié", () => {
    expect(sql).toContain("e.status<>'cancelled' and public.can_manage_business(e.business_id)");
    expect(sql).toContain(
      "e.status='draft' or not exists(select 1 from public.documents d where d.business_id=e.business_id and d.storage_bucket='expense-documents' and d.storage_path=name)",
    );
    const deleteAllowed=(status:"draft"|"validated"|"cancelled",linked:boolean)=>status!=="cancelled"&&(status==="draft"||!linked);
    expect(deleteAllowed("validated",true)).toBe(false);
    expect(deleteAllowed("validated",false)).toBe(true);
    expect(deleteAllowed("draft",true)).toBe(true);
  });

  it("conserve les sept tables métier sous RLS sans politique d'écriture directe", () => {
    expect(migration.match(/create table public\./g)).toHaveLength(7);
    expect(migration.match(/enable row level security/g)).toHaveLength(7);
    expect(migration).not.toMatch(
      /create policy .* on public\.(?:suppliers|expenses|expense_payments|expense_refunds|documents|expense_documents|recurring_expense_templates) for (?:insert|update|delete|all)/i,
    );
  });

  it("garde le bucket privé et n'autorise aucune mise à jour Storage", () => {
    expect(sql).toContain(
      "values('expense-documents','expense-documents',false,10485760",
    );
    expect(sql).toContain("public.is_valid_expense_document_path(name)");
    expect(migration).not.toMatch(
      /create policy .* on storage\.objects for update/i,
    );
    expect(migration).not.toContain("service_role");
  });

  it("révoque les RPC mutationnelles à public et les accorde à authenticated", () => {
    expect(sql).toContain(
      "revoke all on function public.create_supplier(",
    );
    expect(sql).toContain("from public; grant execute on function public.create_supplier(");
    expect(sql).toContain("to authenticated;");
  });
});
