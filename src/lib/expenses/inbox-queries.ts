import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DocumentKind } from "@/types/expenses";
import { RECEIPT_BUCKET } from "./receipt-inbox";

export interface InboxDocument {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  storagePath: string;
}

export interface StoredDocument extends InboxDocument {
  kind: DocumentKind;
  expenseIds: string[];
}

type DocumentRow = { id: string; kind: DocumentKind; original_name: string; mime_type: string; size_bytes: number; created_at: string; storage_path: string; expense_documents: Array<{ expense_id: string }> | null };

const documentColumns = "id,kind,original_name,mime_type,size_bytes,created_at,storage_path,expense_documents(expense_id)";

function toStored(row: DocumentRow): StoredDocument {
  return { id: row.id, kind: row.kind, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, createdAt: row.created_at, storagePath: row.storage_path, expenseIds: (row.expense_documents ?? []).map((link) => link.expense_id) };
}

/** Justificatifs déposés dans la boîte de réception et rattachés à aucune dépense, du plus récent au plus ancien. */
export async function listInboxDocuments(businessId: string): Promise<InboxDocument[]> {
  const supabase = await createClient();
  if (!supabase) throw new Error("INBOX_UNAVAILABLE");
  const { data, error } = await supabase.from("documents").select(documentColumns)
    .eq("business_id", businessId).like("storage_path", `${businessId}/inbox/%`)
    .order("created_at", { ascending: false }).order("id").limit(500);
  if (error) {
    console.error("Lecture de la boîte de réception impossible", { code: error.code });
    throw new Error("INBOX_UNAVAILABLE");
  }
  return (data as unknown as DocumentRow[]).map(toStored).filter((document) => document.expenseIds.length === 0)
    .map(({ id, originalName, mimeType, sizeBytes, createdAt, storagePath }) => ({ id, originalName, mimeType, sizeBytes, createdAt, storagePath }));
}

/** Un document de l'entreprise (boîte de réception ou déjà rattaché), avec ses dépenses. */
export async function getStoredDocument(businessId: string, documentId: string): Promise<StoredDocument | null> {
  const supabase = await createClient();
  if (!supabase) throw new Error("INBOX_UNAVAILABLE");
  const { data, error } = await supabase.from("documents").select(documentColumns).eq("business_id", businessId).eq("id", documentId).maybeSingle();
  if (error) {
    console.error("Lecture du justificatif impossible", { code: error.code });
    throw new Error("INBOX_UNAVAILABLE");
  }
  return data ? toStored(data as unknown as DocumentRow) : null;
}

/** Lien signé d'une minute, jamais public ni permanent. */
export async function signDocumentUrl(storagePath: string): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(storagePath, 60);
  return data?.signedUrl ?? null;
}
