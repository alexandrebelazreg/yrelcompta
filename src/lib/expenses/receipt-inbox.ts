/**
 * Boîte de réception des justificatifs : fichiers déposés sans dépense, rattachés ensuite
 * (par l'utilisatrice ou par Claude via le connecteur) à une ou plusieurs dépenses.
 * Module partagé entre le serveur et le navigateur : aucune dépendance serveur ici.
 */

export const RECEIPT_BUCKET = "expense-documents";

/** Le connecteur n'accepte en base64 que de petits fichiers (photos, vignettes). */
export const MAX_INLINE_RECEIPT_BYTES = 1_048_576;

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const inboxPathPattern = new RegExp(`^${uuid}/inbox/${uuid}/[a-z0-9._-]{1,255}$`);

/** Même normalisation que la base (regexp_replace(lower(nom),'[^a-z0-9._-]+','-','g')). */
export function safeStorageName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

export function inboxStoragePath(businessId: string, documentId: string, originalName: string): string {
  return `${businessId}/inbox/${documentId}/${safeStorageName(originalName)}`;
}

export function isInboxStoragePath(path: string): boolean {
  return inboxPathPattern.test(path) && !/(^|\/)\.\.(\/|$)/.test(path);
}
