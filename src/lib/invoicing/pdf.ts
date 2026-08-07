import "server-only";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { billingOperationCategoryLabels } from "./labels";
import type { BillingDocument } from "@/types/invoicing";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 45;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const REGULAR_FONT = join(process.cwd(), "node_modules", "@fontsource", "noto-sans", "files", "noto-sans-latin-400-normal.woff");
const BOLD_FONT = join(process.cwd(), "node_modules", "@fontsource", "noto-sans", "files", "noto-sans-latin-700-normal.woff");

export function formatPdfEuros(cents: number, negative = false): string {
  if (!Number.isSafeInteger(cents)) throw new Error("PDF_UNSAFE_MONETARY_VALUE");
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100).toLocaleString("fr-FR").replaceAll("\u202f", " ");
  return `${negative && absolute !== 0 ? "- " : ""}${euros},${String(absolute % 100).padStart(2, "0")} €`;
}

function frenchDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("PDF_INVALID_DATE");
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function optionalLines(values: Array<string | null>): string {
  return values.filter((value): value is string => Boolean(value)).join("\n");
}

export async function generateBillingPdf(document: BillingDocument): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", font: REGULAR_FONT, margins: { top: 80, right: MARGIN, bottom: 20, left: MARGIN }, bufferPages: true, autoFirstPage: true, info: { Title: `${document.kind === "invoice" ? "Facture" : "Avoir"} ${document.number}`, Author: document.issuerLegalNameSnapshot } });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.registerFont("Noto", REGULAR_FONT);
    doc.registerFont("NotoBold", BOLD_FONT);
    doc.font("Noto");

    const ensureSpace = (height: number) => {
      if (doc.y + height > PAGE_HEIGHT - 70) doc.addPage();
    };
    const sectionTitle = (title: string) => {
      ensureSpace(34);
      doc.moveDown(0.6).font("NotoBold").fontSize(11).fillColor("#16243b").text(title.toUpperCase(), MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.25).strokeColor("#d7dde7").moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke().moveDown(0.45).font("Noto").fillColor("#1f2937");
    };

    doc.font("NotoBold").fontSize(24).fillColor("#16243b").text(document.kind === "invoice" ? "FACTURE" : "AVOIR", MARGIN, 90);
    doc.fontSize(14).text(document.number, MARGIN, doc.y + 3);
    doc.font("Noto").fontSize(9).fillColor("#4b5563").text(`Date d'émission : ${frenchDate(document.issuedOn)}`, 360, 94, { width: 190, align: "right" });
    doc.text(`Date de vente / livraison : ${frenchDate(document.supplyOn)}`, 330, 110, { width: 220, align: "right" });
    doc.y = 145;
    if (document.kind === "credit_note") {
      doc.font("NotoBold").fillColor("#9b2c2c").text(`Avoir relatif à la facture ${document.originalInvoiceNumber ?? "—"} du ${document.originalInvoiceIssuedOn ? frenchDate(document.originalInvoiceIssuedOn) : "—"}`, MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.font("Noto").fillColor("#1f2937").text(`Motif : ${document.creditReason ?? "—"}`, { width: CONTENT_WIDTH });
      doc.moveDown(0.5);
    }

    sectionTitle("Parties");
    const seller = optionalLines([
      document.issuerLegalNameSnapshot,
      document.issuerTradeNameSnapshot,
      document.issuerAddressSnapshot,
      `SIREN : ${document.issuerSirenSnapshot}`,
      `SIRET : ${document.issuerSiretSnapshot}`,
      document.issuerRegistrationDetailsSnapshot,
      document.issuerEmailSnapshot,
      document.issuerPhoneSnapshot,
    ]);
    const buyer = optionalLines([
      document.buyerName,
      document.buyerAddress ?? (document.buyerAddressOmitted ? "Adresse omise à la demande du particulier" : null),
      document.buyerBillingAddress ? `Adresse de facturation : ${document.buyerBillingAddress}` : null,
      document.buyerDeliveryAddress ? `Adresse de livraison : ${document.buyerDeliveryAddress}` : null,
      document.buyerSiren ? `SIREN : ${document.buyerSiren}` : null,
      document.buyerVatNumber ? `TVA intracommunautaire : ${document.buyerVatNumber}` : null,
      document.buyerEmail,
      document.purchaseOrderReference ? `Bon de commande : ${document.purchaseOrderReference}` : null,
    ]);
    const partiesY = doc.y;
    doc.font("NotoBold").fontSize(9).text("VENDEUR", MARGIN, partiesY, { width: 235 }).font("Noto").text(seller, MARGIN, partiesY + 17, { width: 235, lineGap: 2 });
    doc.font("NotoBold").text("CLIENT", 315, partiesY, { width: 235 }).font("Noto").text(buyer, 315, partiesY + 17, { width: 235, lineGap: 2 });
    doc.y = partiesY + Math.max(doc.heightOfString(seller, { width: 235, lineGap: 2 }), doc.heightOfString(buyer, { width: 235, lineGap: 2 })) + 28;

    sectionTitle("Nature de l'opération");
    doc.fontSize(9).text(billingOperationCategoryLabels[document.operationCategory]);
    sectionTitle("Détail");
    const columnX = [MARGIN, 315, 375, 465];
    const tableHeaderY = doc.y;
    doc.font("NotoBold").fontSize(8).fillColor("#4b5563").text("Désignation", columnX[0], tableHeaderY, { width: 255 }).text("Qté", columnX[1], tableHeaderY, { width: 45, align: "right" }).text("Prix unitaire HT", columnX[2], tableHeaderY, { width: 80, align: "right" }).text("Total HT", columnX[3], tableHeaderY, { width: 85, align: "right" });
    doc.y = tableHeaderY + 18;
    doc.font("Noto").fillColor("#1f2937");
    for (const item of document.items) {
      const rowHeight = Math.max(22, doc.heightOfString(item.description, { width: 255 }) + 10);
      ensureSpace(rowHeight + 8);
      const y = doc.y;
      doc.fontSize(8.5).text(item.description, columnX[0], y, { width: 255 }).text(String(item.quantity), columnX[1], y, { width: 45, align: "right" }).text(formatPdfEuros(item.unitPriceExclTaxCents, document.kind === "credit_note"), columnX[2], y, { width: 80, align: "right" }).text(formatPdfEuros(item.lineTotalExclTaxCents, document.kind === "credit_note"), columnX[3], y, { width: 85, align: "right" });
      doc.strokeColor("#e5e7eb").moveTo(MARGIN, y + rowHeight - 2).lineTo(PAGE_WIDTH - MARGIN, y + rowHeight - 2).stroke();
      doc.y = y + rowHeight;
    }

    ensureSpace(155);
    sectionTitle("Synthèse");
    const credit = document.kind === "credit_note";
    const totalLine = (label: string, amount: number, bold = false, negative = credit) => {
      const y = doc.y;
      doc.font(bold ? "NotoBold" : "Noto").fontSize(bold ? 10 : 9).text(label, 315, y, { width: 135 }).text(formatPdfEuros(amount, negative), 450, y, { width: 100, align: "right" });
      doc.y = y + (bold ? 19 : 17);
    };
    totalLine("Sous-total HT", document.subtotalExclTaxCents);
    totalLine("Livraison", document.shippingExclTaxCents);
    totalLine("Remise", document.discountExclTaxCents, false, credit || document.discountExclTaxCents > 0);
    totalLine("Total HT", document.totalExclTaxCents);
    totalLine("TVA", document.vatCents);
    totalLine(document.kind === "invoice" ? "Total TTC" : "Montant crédité", document.totalInclTaxCents, true);
    doc.font("Noto").fontSize(8.5).fillColor("#374151").text(document.vatExemptionMentionSnapshot, MARGIN, doc.y + 4, { width: CONTENT_WIDTH });
    doc.moveDown(0.6).text(`Échéance : ${frenchDate(document.paymentDueOn)}`);

    if (document.buyerKind === "professional") {
      sectionTitle("Conditions de paiement");
      for (const value of [document.paymentTermsSnapshot, document.earlyPaymentDiscountTermsSnapshot, document.latePenaltyTermsSnapshot, document.recoveryIndemnitySnapshot]) {
        if (value) doc.fontSize(8.5).text(value, { width: CONTENT_WIDTH }).moveDown(0.3);
      }
    }

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(range.start + index);
      doc.font("NotoBold").fontSize(8).fillColor("#16243b").text(`${document.kind === "invoice" ? "FACTURE" : "AVOIR"} ${document.number}`, MARGIN, 34, { width: 350 });
      doc.font("Noto").fillColor("#6b7280").text(`Page ${index + 1} / ${range.count}`, 430, 34, { width: 120, align: "right" });
      doc.fontSize(7.5).text("Document commercial généré depuis les snapshots immuables YrelCompta.", MARGIN, PAGE_HEIGHT - 38, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
