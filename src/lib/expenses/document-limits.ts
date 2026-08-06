export const MAX_EXPENSE_DOCUMENT_BYTES = 10_485_760;
export const EXPENSE_DOCUMENT_SIZE_ERROR =
  "Le fichier doit peser au maximum 10 Mio.";

export function getExpenseDocumentSizeError(size: number): string | null {
  return size > MAX_EXPENSE_DOCUMENT_BYTES
    ? EXPENSE_DOCUMENT_SIZE_ERROR
    : null;
}
