import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { getStoredDocument, listInboxDocuments } from "@/lib/expenses/inbox-queries";
import { documentKindLabels, expenseStatusLabels } from "@/lib/expenses/labels";
import { getExpense, listExpenses } from "@/lib/expenses/queries";
import { inboxStoragePath, MAX_INLINE_RECEIPT_BYTES, RECEIPT_BUCKET } from "@/lib/expenses/receipt-inbox";
import { allowedDocumentMimes, validateExpenseFile } from "@/lib/expenses/validation";
import type { DocumentKind, Expense } from "@/types/expenses";
import type { McpToolContext } from "./auth";
import { decodeInlineFile, matchesMimeSignature } from "./file-input";
import { McpContentResult, McpToolError, type McpContentBlock, type McpTool } from "./protocol";

/** Au-delà, le texte extrait est tronqué pour rester lisible par Claude. */
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;
/** Images transmises à Claude telles quelles jusqu'à cette taille. */
export const MAX_PREVIEW_IMAGE_BYTES = 3_500_000;

const lower = (value: string) => value.trim().toLocaleLowerCase("fr");
const listing = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => `${key} = ${label}`).join(", ");
const kibibytes = (bytes: number) => `${Math.ceil(bytes / 1024)} Ko`;

const receiptKey = z.string().uuid().describe("Identifiant du justificatif (voir list_unassigned_receipts, ou get_expense pour un justificatif déjà rattaché).");
const expenseKeys = z.array(z.string().trim().min(1).max(80)).min(1).max(20).describe("Dépenses à justifier : identifiants ou références (ex. DEP-2026-0042). Une même commande saisie en plusieurs dépenses reçoit le même fichier.");
const documentKind = z.enum(["supplier_invoice", "receipt", "bank_proof", "credit_note", "contract", "other"]).default("supplier_invoice").describe(`Type de justificatif, fixé au premier rattachement : ${listing(documentKindLabels)}.`);
const confirmation = z.literal(true).optional().describe("Obligatoire si une des dépenses est VALIDÉE (rattachement définitif) : true UNIQUEMENT après accord explicite de l’utilisatrice sur ce rattachement précis.");

async function resolveExpense(businessId: string, key: string): Promise<Expense> {
  const id = z.string().uuid().safeParse(key).success ? key : (await listExpenses(businessId, { search: key })).find((expense) => lower(expense.reference) === lower(key))?.id;
  const expense = id ? await getExpense(businessId, id) : null;
  if (!expense) throw new McpToolError(`Aucune dépense ne correspond à « ${key} ». Consultez list_expenses.`);
  if (expense.status === "cancelled") throw new McpToolError(`La dépense ${expense.reference} est annulée : on ne peut plus lui joindre de justificatif.`);
  return expense;
}

/** Résout les dépenses et exige la confirmation si un rattachement serait définitif. */
async function prepareTargets(businessId: string, keys: string[], confirmed: boolean): Promise<Expense[]> {
  const expenses: Expense[] = [];
  for (const key of keys) {
    const expense = await resolveExpense(businessId, key);
    if (!expenses.some((known) => known.id === expense.id)) expenses.push(expense);
  }
  const validated = expenses.filter((expense) => expense.status === "validated");
  if (validated.length > 0 && !confirmed) {
    throw new McpToolError(`Le rattachement à une dépense validée (${validated.map((expense) => expense.reference).join(", ")}) est définitif : récapitulez-le à l’utilisatrice et renseignez confirmation après son accord explicite.`);
  }
  return expenses;
}

async function attach(context: McpToolContext, documentId: string, expenses: Expense[], kind: DocumentKind) {
  const { data, error } = await context.supabase.rpc("attach_document_to_expenses", { p_document_id: documentId, p_business_id: context.businessId, p_expense_ids: expenses.map((expense) => expense.id), p_kind: kind });
  if (error) {
    console.error("Rattachement du justificatif refusé", { code: error.code });
    if (error.code === "P0002") throw new McpToolError("Le justificatif ou une des dépenses est introuvable (ou annulée).");
    if (error.code === "42501") throw new McpToolError("Accès refusé à cette entreprise.");
    throw new McpToolError("Le rattachement a été refusé par YrelCompta.");
  }
  return {
    nouveaux_rattachements: Number(data ?? 0),
    depenses: expenses.map((expense) => ({ reference: expense.reference, description: expense.description, statut: expenseStatusLabels[expense.status], lien: `${context.origin}/depenses/${expense.id}` })),
  };
}

export { decodeInlineFile, matchesMimeSignature };

export const receiptTools: McpTool<McpToolContext>[] = [
  {
    name: "list_unassigned_receipts",
    title: "Justificatifs à rattacher",
    description: "Liste les justificatifs déposés par l’utilisatrice dans la boîte de réception et pas encore rattachés à une dépense (nom, type, taille, date de dépôt). Lisez-les avec get_receipt_content pour retrouver le numéro de commande, puis rattachez-les avec attach_receipt_to_expenses.",
    input: z.object({}),
    run: async (_input, { businessId, origin }) => {
      const documents = await listInboxDocuments(businessId);
      return {
        page_de_depot: `${origin}/documents/depot`,
        justificatifs: documents.map((document) => ({ id: document.id, nom: document.originalName, type: document.mimeType, taille: kibibytes(document.sizeBytes), depose_le: document.createdAt.slice(0, 10) })),
      };
    },
  },
  {
    name: "get_receipt_content",
    title: "Contenu d’un justificatif",
    description: "Lit un justificatif : texte extrait d’un PDF, ou l’image elle-même pour une photo (JPEG, PNG, WebP). Sert à retrouver le fournisseur, la date, le montant et le numéro de commande. Un PDF scanné n’a pas de texte : demandez alors à l’utilisatrice.",
    input: z.object({ receipt: receiptKey }),
    run: async (input, { supabase, businessId }) => {
      const document = await getStoredDocument(businessId, (input as { receipt: string }).receipt);
      if (!document) throw new McpToolError("Aucun justificatif ne correspond à cet identifiant. Consultez list_unassigned_receipts.");
      const meta = { id: document.id, nom: document.originalName, type: document.mimeType, taille: kibibytes(document.sizeBytes), rattache_a: document.expenseIds };
      const isPreviewableImage = ["image/jpeg", "image/png", "image/webp"].includes(document.mimeType);
      if (document.mimeType !== "application/pdf" && !(isPreviewableImage && document.sizeBytes <= MAX_PREVIEW_IMAGE_BYTES)) {
        return { ...meta, contenu: null, remarque: isPreviewableImage ? "Image trop volumineuse pour être transmise : demandez à l’utilisatrice de lire le numéro de commande." : "Format HEIC non lisible ici : demandez à l’utilisatrice ce que contient ce justificatif." };
      }
      const { data: blob, error } = await supabase.storage.from(RECEIPT_BUCKET).download(document.storagePath);
      if (error || !blob) {
        console.error("Lecture Storage du justificatif impossible", { code: error?.name });
        throw new McpToolError("Le fichier de ce justificatif est momentanément illisible.");
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (isPreviewableImage) {
        const blocks: McpContentBlock[] = [{ type: "text", text: JSON.stringify(meta) }, { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: document.mimeType }];
        return new McpContentResult(blocks);
      }
      let text = "";
      let pages = 0;
      try {
        const pdf = await getDocumentProxy(bytes);
        const extracted = await extractText(pdf, { mergePages: true });
        text = extracted.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        pages = extracted.totalPages;
      } catch {
        return { ...meta, contenu: null, remarque: "Ce PDF n’a pas pu être lu (fichier protégé ou abîmé) : demandez à l’utilisatrice ce qu’il contient." };
      }
      if (!text) return { ...meta, pages, contenu: null, remarque: "Ce PDF ne contient pas de texte (document scanné) : demandez à l’utilisatrice le numéro de commande." };
      return { ...meta, pages, contenu: text.slice(0, MAX_EXTRACTED_TEXT_CHARS), tronque: text.length > MAX_EXTRACTED_TEXT_CHARS };
    },
  },
  {
    name: "attach_receipt_to_expenses",
    kind: "write",
    title: "Rattacher un justificatif",
    description: "Rattache un justificatif (de la boîte de réception ou déjà rattaché ailleurs) à une ou plusieurs dépenses, brouillons ou validées, sans changer leur montant. Sur une dépense validée, le rattachement est définitif et exige confirmation.",
    input: z.object({ receipt: receiptKey, expenses: expenseKeys, kind: documentKind, confirmation }),
    run: async (input, context) => {
      const data = input as { receipt: string; expenses: string[]; kind: DocumentKind; confirmation?: true };
      const document = await getStoredDocument(context.businessId, data.receipt);
      if (!document) throw new McpToolError("Aucun justificatif ne correspond à cet identifiant. Consultez list_unassigned_receipts.");
      const expenses = await prepareTargets(context.businessId, data.expenses, data.confirmation === true);
      return { rattache: true, justificatif: document.originalName, ...(await attach(context, document.id, expenses, data.kind)) };
    },
  },
  {
    name: "upload_receipt",
    kind: "write",
    title: "Envoyer un petit justificatif",
    description: `Envoie un PETIT fichier (1 Mio au plus, en pratique une photo ou une vignette) encodé en base64, puis le rattache éventuellement à des dépenses. Pour les PDF et les fichiers plus gros, demandez à l’utilisatrice de les déposer sur la page « Déposer des justificatifs » de YrelCompta, puis utilisez list_unassigned_receipts.`,
    input: z.object({
      file_base64: z.string().min(4).max(Math.ceil(MAX_INLINE_RECEIPT_BYTES / 3) * 4 + 100).describe("Contenu du fichier en base64 (1 Mio au plus une fois décodé)."),
      filename: z.string().trim().min(1).max(255).describe("Nom du fichier avec son extension, ex. facture-1234.jpg."),
      mime_type: z.enum(allowedDocumentMimes),
      expenses: expenseKeys.optional(),
      kind: documentKind,
      confirmation,
    }),
    run: async (input, context) => {
      const data = input as { file_base64: string; filename: string; mime_type: string; expenses?: string[]; kind: DocumentKind; confirmation?: true };
      const bytes = decodeInlineFile(data.file_base64);
      if (bytes.byteLength > MAX_INLINE_RECEIPT_BYTES) throw new McpToolError("Fichier trop gros pour être envoyé ainsi (1 Mio au plus) : demandez à l’utilisatrice de le déposer sur la page « Déposer des justificatifs ».");
      const invalid = validateExpenseFile({ name: data.filename, size: bytes.byteLength, type: data.mime_type });
      if (invalid) throw new McpToolError(invalid);
      if (!matchesMimeSignature(bytes, data.mime_type)) throw new McpToolError("Le contenu du fichier ne correspond pas au type annoncé.");
      const expenses = data.expenses ? await prepareTargets(context.businessId, data.expenses, data.confirmation === true) : [];
      const documentId = crypto.randomUUID();
      const path = inboxStoragePath(context.businessId, documentId, data.filename);
      const upload = await context.supabase.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: data.mime_type, upsert: false });
      if (upload.error) {
        console.error("Envoi du justificatif refusé", { code: upload.error.name });
        throw new McpToolError("L’envoi du fichier a été refusé par YrelCompta.");
      }
      const { error } = await context.supabase.rpc("register_inbox_document", { p_document_id: documentId, p_business_id: context.businessId, p_storage_path: path, p_original_name: data.filename, p_mime_type: data.mime_type, p_size_bytes: bytes.byteLength });
      if (error) {
        console.error("Enregistrement du justificatif refusé", { code: error.code });
        const cleanup = await context.supabase.storage.from(RECEIPT_BUCKET).remove([path]);
        if (cleanup.error) console.error("Nettoyage du justificatif refusé", { code: cleanup.error.name });
        throw new McpToolError("Le justificatif n’a pas pu être enregistré.");
      }
      if (expenses.length === 0) return { envoye: true, id: documentId, nom: data.filename, rattache: false, remarque: "Le fichier attend dans la boîte de réception : rattachez-le avec attach_receipt_to_expenses." };
      try {
        return { envoye: true, id: documentId, nom: data.filename, rattache: true, ...(await attach(context, documentId, expenses, data.kind)) };
      } catch (error) {
        const reason = error instanceof McpToolError ? error.message : "erreur inattendue";
        throw new McpToolError(`Le fichier est bien dans la boîte de réception (id ${documentId}), mais son rattachement a échoué : ${reason}`);
      }
    },
  },
];
