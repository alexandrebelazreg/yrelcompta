"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { registerInboxDocumentAction } from "@/lib/expenses/inbox-actions";
import { inboxStoragePath, RECEIPT_BUCKET } from "@/lib/expenses/receipt-inbox";
import { validateExpenseFile } from "@/lib/expenses/validation";
import { createClient } from "@/lib/supabase/client";

type Status = { name: string; state: "pending" | "done" | "error"; message?: string };

/**
 * Dépôt groupé : chaque fichier part directement du navigateur vers le Storage privé (chemin de
 * la boîte de réception, contrôlé par RLS), puis ses métadonnées sont enregistrées côté serveur.
 */
export function ReceiptDropzone({ businessId }: { businessId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function send(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setStatuses(files.map((file) => ({ name: file.name, state: "pending" })));
    const update = (index: number, status: Partial<Status>) => setStatuses((current) => current.map((item, i) => i === index ? { ...item, ...status } : item));
    const supabase = createClient();
    for (const [index, file] of files.entries()) {
      const invalid = validateExpenseFile(file);
      if (invalid) { update(index, { state: "error", message: invalid }); continue; }
      const documentId = crypto.randomUUID();
      const upload = await supabase.storage.from(RECEIPT_BUCKET).upload(inboxStoragePath(businessId, documentId, file.name), file, { contentType: file.type, upsert: false });
      if (upload.error) { update(index, { state: "error", message: "Envoi refusé." }); continue; }
      const result = await registerInboxDocumentAction({ documentId, originalName: file.name, mimeType: file.type, sizeBytes: file.size });
      update(index, result.ok ? { state: "done" } : { state: "error", message: result.error });
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void send(Array.from(event.dataTransfer.files));
  }

  const failed = statuses.filter((status) => status.state === "error").length;
  const done = statuses.filter((status) => status.state === "done").length;

  return (
    <div className="receipt-dropzone-wrap">
      <label
        className={`receipt-dropzone${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
        htmlFor="receipt-files"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <strong>{busy ? "Envoi en cours…" : "Glissez vos justificatifs ici"}</strong>
        <span>ou cliquez pour les choisir · PDF, JPEG, PNG, WebP ou HEIC · 10 Mio maximum par fichier</span>
        <input
          ref={input}
          className="sr-only"
          disabled={busy}
          id="receipt-files"
          multiple
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          onChange={(event) => void send(Array.from(event.currentTarget.files ?? []))}
        />
      </label>
      {statuses.length > 0 && (
        <div aria-live="polite">
          {!busy && <p className={`form-message${failed === 0 ? " success" : ""}`}>{done} fichier{done > 1 ? "s" : ""} déposé{done > 1 ? "s" : ""}{failed > 0 ? `, ${failed} refusé${failed > 1 ? "s" : ""}` : ""}.</p>}
          <ul className="receipt-upload-list">
            {statuses.map((status, index) => (
              <li key={`${status.name}-${index}`} className={`is-${status.state}`}>
                <span>{status.name}</span>
                <span>{status.state === "pending" ? "En attente…" : status.state === "done" ? "Déposé" : status.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
