import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ listInboxDocuments: vi.fn(), getStoredDocument: vi.fn(), listExpenses: vi.fn(), getExpense: vi.fn(), extractText: vi.fn(), getDocumentProxy: vi.fn() }));
vi.mock("@/lib/expenses/inbox-queries", () => ({ listInboxDocuments: mocks.listInboxDocuments, getStoredDocument: mocks.getStoredDocument }));
vi.mock("@/lib/expenses/queries", () => ({ listExpenses: mocks.listExpenses, getExpense: mocks.getExpense }));
vi.mock("unpdf", () => ({ extractText: mocks.extractText, getDocumentProxy: mocks.getDocumentProxy }));

const { receiptTools, matchesMimeSignature, decodeInlineFile } = await import("./receipt-tools");
const { handleMcpMessage } = await import("./protocol");

const BIZ = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const VALIDATED = "44444444-4444-4444-8444-444444444444";
const expenses: Record<string, Record<string, unknown>> = {
  [DRAFT]: { id: DRAFT, reference: "DEP-2026-0001", description: "Perles", status: "draft" },
  [VALIDATED]: { id: VALIDATED, reference: "DEP-2026-0002", description: "Fermoirs", status: "validated" },
  "55555555-5555-4555-8555-555555555555": { id: "55555555-5555-4555-8555-555555555555", reference: "DEP-2026-0003", description: "Annulée", status: "cancelled" },
};
const pdfBytes = new TextEncoder().encode("%PDF-1.7 contenu");
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let rpc: ReturnType<typeof vi.fn>;
let upload: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let download: ReturnType<typeof vi.fn>;
function context() {
  return { supabase: { rpc, storage: { from: () => ({ upload, remove, download }) } }, userId: "user", businessId: BIZ, businessName: "Bijoux", clientId: "claude", origin: "https://yrelcompta.example" };
}
async function call(name: string, args: Record<string, unknown>) {
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, receiptTools, context() as never) as { result: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } };
  return { isError: Boolean(response.result.isError), content: response.result.content, text: response.result.content[0].text ?? "" };
}
const stored = (overrides: Record<string, unknown> = {}) => ({ id: DOC, kind: "other", originalName: "Facture 1234.pdf", mimeType: "application/pdf", sizeBytes: 2048, createdAt: "2026-11-19T10:00:00Z", storagePath: `${BIZ}/inbox/${DOC}/facture-1234.pdf`, expenseIds: [], ...overrides });

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: 1, error: null }));
  upload = vi.fn(async () => ({ data: {}, error: null }));
  remove = vi.fn(async () => ({ data: [], error: null }));
  download = vi.fn(async () => ({ data: new Blob([pdfBytes]), error: null }));
  mocks.getStoredDocument.mockResolvedValue(stored());
  mocks.listInboxDocuments.mockResolvedValue([stored()]);
  mocks.getExpense.mockImplementation(async (_business: string, id: string) => expenses[id] ?? null);
  mocks.listExpenses.mockImplementation(async (_business: string, filters: { search: string }) => Object.values(expenses).filter((expense) => String(expense.reference).toLowerCase() === filters.search.toLowerCase()));
  mocks.getDocumentProxy.mockResolvedValue({});
  mocks.extractText.mockResolvedValue({ totalPages: 1, text: "Commande n° 1234\n\n\n\nTotal 38,90 €" });
});

describe("boîte de réception des justificatifs (connecteur)", () => {
  it("liste les justificatifs en attente avec la page de dépôt", async () => {
    const result = JSON.parse((await call("list_unassigned_receipts", {})).text);
    expect(result.page_de_depot).toBe("https://yrelcompta.example/documents/depot");
    expect(result.justificatifs).toEqual([{ id: DOC, nom: "Facture 1234.pdf", type: "application/pdf", taille: "2 Ko", depose_le: "2026-11-19" }]);
  });

  it("renvoie le texte d’un PDF", async () => {
    const result = JSON.parse((await call("get_receipt_content", { receipt: DOC })).text);
    expect(result).toMatchObject({ id: DOC, pages: 1, contenu: "Commande n° 1234\n\nTotal 38,90 €", tronque: false });
  });

  it("signale un PDF scanné sans texte", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 2, text: "  \n " });
    const result = JSON.parse((await call("get_receipt_content", { receipt: DOC })).text);
    expect(result.contenu).toBeNull();
    expect(result.remarque).toContain("scanné");
  });

  it("transmet une photo comme image", async () => {
    mocks.getStoredDocument.mockResolvedValue(stored({ mimeType: "image/png", originalName: "ticket.png" }));
    download.mockResolvedValue({ data: new Blob([pngBytes]), error: null });
    const result = await call("get_receipt_content", { receipt: DOC });
    expect(result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: Buffer.from(pngBytes).toString("base64") });
  });

  it("ne télécharge pas une image HEIC illisible par Claude", async () => {
    mocks.getStoredDocument.mockResolvedValue(stored({ mimeType: "image/heic" }));
    const result = JSON.parse((await call("get_receipt_content", { receipt: DOC })).text);
    expect(result.remarque).toContain("HEIC");
    expect(download).not.toHaveBeenCalled();
  });

  it("rattache un justificatif à plusieurs brouillons, par référence ou identifiant", async () => {
    mocks.getExpense.mockImplementation(async (_business: string, id: string) => id === VALIDATED ? { ...expenses[DRAFT], id: VALIDATED, reference: "DEP-2026-0002" } : expenses[id] ?? null);
    const result = await call("attach_receipt_to_expenses", { receipt: DOC, expenses: ["dep-2026-0001", VALIDATED] });
    expect(result.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("attach_document_to_expenses", { p_document_id: DOC, p_business_id: BIZ, p_expense_ids: [DRAFT, VALIDATED], p_kind: "supplier_invoice" });
  });

  it("exige la confirmation pour une dépense validée", async () => {
    const blocked = await call("attach_receipt_to_expenses", { receipt: DOC, expenses: [DRAFT, VALIDATED] });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain("DEP-2026-0002");
    expect(rpc).not.toHaveBeenCalled();
    const confirmed = await call("attach_receipt_to_expenses", { receipt: DOC, expenses: [DRAFT, VALIDATED], kind: "receipt", confirmation: true });
    expect(confirmed.isError).toBe(false);
    expect(rpc).toHaveBeenCalledWith("attach_document_to_expenses", expect.objectContaining({ p_kind: "receipt" }));
  });

  it("refuse une dépense annulée", async () => {
    const result = await call("attach_receipt_to_expenses", { receipt: DOC, expenses: ["DEP-2026-0003"] });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("envoie une petite photo dans la boîte de réception puis la rattache", async () => {
    const result = await call("upload_receipt", { file_base64: Buffer.from(pngBytes).toString("base64"), filename: "Ticket Marché.png", mime_type: "image/png", expenses: [DRAFT] });
    expect(result.isError).toBe(false);
    const [path, body, options] = upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${BIZ}/inbox/[0-9a-f-]{36}/ticket-march-.png$`));
    expect(body).toEqual(pngBytes);
    expect(options).toEqual({ contentType: "image/png", upsert: false });
    expect(rpc).toHaveBeenNthCalledWith(1, "register_inbox_document", expect.objectContaining({ p_business_id: BIZ, p_storage_path: path, p_original_name: "Ticket Marché.png", p_size_bytes: pngBytes.byteLength }));
    expect(rpc).toHaveBeenNthCalledWith(2, "attach_document_to_expenses", expect.objectContaining({ p_expense_ids: [DRAFT] }));
  });

  it("refuse un contenu qui ne correspond pas au type annoncé, sans rien envoyer", async () => {
    const result = await call("upload_receipt", { file_base64: Buffer.from(pdfBytes).toString("base64"), filename: "photo.png", mime_type: "image/png" });
    expect(result.isError).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuse un fichier de plus de 1 Mio", async () => {
    const big = new Uint8Array(1_048_577);
    big.set(pdfBytes);
    const result = await call("upload_receipt", { file_base64: Buffer.from(big).toString("base64"), filename: "gros.pdf", mime_type: "application/pdf" });
    expect(result.isError).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it("retire le fichier envoyé si son enregistrement échoue", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "invalid storage path" } });
    const result = await call("upload_receipt", { file_base64: Buffer.from(pdfBytes).toString("base64"), filename: "facture.pdf", mime_type: "application/pdf" });
    expect(result.isError).toBe(true);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });
});

describe("contrôles des fichiers envoyés en base64", () => {
  it("reconnaît les signatures des formats autorisés", () => {
    expect(matchesMimeSignature(pdfBytes, "application/pdf")).toBe(true);
    expect(matchesMimeSignature(pngBytes, "image/png")).toBe(true);
    expect(matchesMimeSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
    expect(matchesMimeSignature(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(true);
    expect(matchesMimeSignature(pngBytes, "application/pdf")).toBe(false);
  });

  it("accepte un préfixe data: et refuse un base64 invalide", () => {
    expect(decodeInlineFile(`data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`)).toEqual(pdfBytes);
    expect(() => decodeInlineFile("pas du base64 !")).toThrow();
  });
});
