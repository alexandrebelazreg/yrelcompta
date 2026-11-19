"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { inboxStoragePath, RECEIPT_BUCKET } from "./receipt-inbox";
import { validateExpenseFile } from "./validation";

const INBOX_PAGE = "/documents/depot";

async function ctx() {
  const { userId, context } = await getAuthenticatedContext();
  const supabase = await createClient();
  if (!userId || !context.business || !supabase) return null;
  return { supabase, businessId: context.business.id };
}

const registration = z.object({
  documentId: z.string().uuid(),
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export type InboxRegistrationResult = { ok: true } | { ok: false; error: string };

/**
 * Enregistre un fichier que le navigateur vient de déposer dans Storage (chemin de la boîte de
 * réception). En cas de refus, le fichier déposé est retiré pour ne pas laisser d'orphelin.
 */
export async function registerInboxDocumentAction(input: z.input<typeof registration>): Promise<InboxRegistrationResult> {
  const parsed = registration.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fichier invalide." };
  const file = parsed.data;
  const invalid = validateExpenseFile({ name: file.originalName, size: file.sizeBytes, type: file.mimeType });
  const c = await ctx();
  if (!c) return { ok: false, error: "Session expirée : reconnectez-vous." };
  const path = inboxStoragePath(c.businessId, file.documentId, file.originalName);
  if (!invalid) {
    const { error } = await c.supabase.rpc("register_inbox_document", { p_document_id: file.documentId, p_business_id: c.businessId, p_storage_path: path, p_original_name: file.originalName, p_mime_type: file.mimeType, p_size_bytes: file.sizeBytes });
    if (!error) {
      revalidatePath(INBOX_PAGE);
      return { ok: true };
    }
    console.error("Enregistrement du dépôt refusé", { code: error.code });
  }
  const cleanup = await c.supabase.storage.from(RECEIPT_BUCKET).remove([path]);
  if (cleanup.error) console.error("Nettoyage du dépôt refusé", { code: cleanup.error.name });
  return { ok: false, error: invalid ?? "Le fichier n’a pas pu être enregistré." };
}

export async function deleteInboxDocumentAction(formData: FormData) {
  const documentId = z.string().uuid().safeParse(formData.get("documentId"));
  const c = await ctx();
  if (!documentId.success || !c) redirect(`${INBOX_PAGE}?erreur=${encodeURIComponent("Justificatif invalide ou session expirée.")}`);
  const { data, error } = await c.supabase.rpc("delete_inbox_document", { p_document_id: documentId.data, p_business_id: c.businessId });
  if (error) {
    console.error("Suppression du dépôt refusée", { code: error.code });
    const message = error.message?.includes("document is attached") ? "Ce justificatif est déjà rattaché à une dépense." : "Le justificatif n’a pas pu être supprimé.";
    redirect(`${INBOX_PAGE}?erreur=${encodeURIComponent(message)}`);
  }
  if (typeof data === "string" && data) {
    const removed = await c.supabase.storage.from(RECEIPT_BUCKET).remove([data]);
    if (removed.error) console.error("Suppression Storage du dépôt refusée", { code: removed.error.name });
  }
  revalidatePath(INBOX_PAGE);
  redirect(`${INBOX_PAGE}?message=supprime`);
}
