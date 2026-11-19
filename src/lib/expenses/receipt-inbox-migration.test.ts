import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inboxStoragePath, isInboxStoragePath, safeStorageName } from "./receipt-inbox";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261119120000_receipt_inbox.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");
const section = (start: string, end: string) => sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start)));

describe("boîte de réception des justificatifs : migration", () => {
  it("rattache à plusieurs dépenses non annulées, validées comprises, sans doublon de lien", () => {
    const attach = section("create function public.attach_document_to_expenses(", "end $$;");
    expect(attach).toContain("public.assert_expense_manager(p_business_id)");
    expect(attach).toContain("status<>'cancelled' for share");
    expect(attach).toContain("cardinality(wanted)>20");
    expect(attach).toContain("on conflict (expense_id,document_id) do nothing");
    expect(attach).not.toContain("status='draft'");
  });

  it("ne change le type d’un document qu’avant son premier rattachement, et rien d’autre", () => {
    expect(sql).toContain("(to_jsonb(new)-'kind')=(to_jsonb(old)-'kind')");
    const attach = section("create function public.attach_document_to_expenses(", "end $$;");
    expect(attach.indexOf("not exists(select 1 from public.expense_documents where document_id=p_document_id")).toBeLessThan(attach.indexOf("update public.documents set kind=p_kind"));
  });

  it("conserve un document encore rattaché ou issu de la boîte de réception quand on le retire d’un brouillon", () => {
    const detach = section("create or replace function public.delete_draft_expense_document(", "end $$;");
    expect(detach).toContain("if s is distinct from 'draft' then raise exception 'draft required'");
    expect(detach.indexOf("public.is_valid_inbox_document_path(canonical_path) or exists(")).toBeLessThan(detach.indexOf("delete from public.documents"));
    expect(detach).toContain("return null;");
  });

  it("ne supprime de la boîte de réception qu’un document rattaché à aucune dépense", () => {
    const remove = section("create function public.delete_inbox_document(", "end $$;");
    expect(remove).toContain("raise exception 'document is attached'");
    expect(remove).toContain("not public.is_valid_inbox_document_path(canonical_path)");
  });

  it("n’autorise l’effacement d’un fichier Storage qu’une fois ses métadonnées retirées", () => {
    for (const policy of ["receipt_inbox_storage_delete", "expense_documents_storage_delete on storage.objects for delete to authenticated using"]) {
      expect(section(`create policy ${policy}`, ");")).toContain("not exists(select 1 from public.documents d where d.storage_bucket='expense-documents' and d.storage_path=name)");
    }
    expect(sql).toContain("drop policy expense_documents_storage_delete on storage.objects;");
  });

  it("réserve le dépôt aux gestionnaires et la lecture aux membres de l’entreprise du document", () => {
    expect(section("create policy receipt_inbox_storage_insert", ");")).toContain("public.can_manage_business(b.id)");
    expect(section("create policy registered_documents_storage_select", ");")).toContain("public.is_business_member(d.business_id)");
    // Sans lecture, Storage ne peut ni relire un dépôt ni effacer un fichier dont les métadonnées sont retirées.
    expect(section("create policy receipt_inbox_storage_select", ");")).toContain("public.is_valid_inbox_document_path(name)");
  });

  it("vérifie le chemin canonique du dépôt et n’ouvre aucun droit anonyme", () => {
    expect(sql).toContain("p_storage_path is distinct from p_business_id::text||'/inbox/'||p_document_id::text||'/'||regexp_replace(lower(p_original_name),'[^a-z0-9._-]+','-','g')");
    expect(sql).toContain("from public,anon;");
    expect(migration).not.toMatch(/to anon/i);
  });
});

describe("chemins de la boîte de réception", () => {
  const business = "11111111-1111-4111-8111-111111111111";
  const document = "22222222-2222-4222-8222-222222222222";

  it("produit le même nom de fichier que la base", () => {
    expect(safeStorageName("Facture N° 12 (Perles).PDF")).toBe("facture-n-12-perles-.pdf");
    expect(inboxStoragePath(business, document, "Ticket.jpg")).toBe(`${business}/inbox/${document}/ticket.jpg`);
  });

  it("reconnaît uniquement les chemins de la boîte de réception", () => {
    expect(isInboxStoragePath(inboxStoragePath(business, document, "a.pdf"))).toBe(true);
    expect(isInboxStoragePath(`${business}/${document}/${document}/a.pdf`)).toBe(false);
    expect(isInboxStoragePath(`${business}/inbox/${document}/..`)).toBe(false);
  });
});
