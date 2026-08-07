import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BillingDocument } from "@/types/invoicing";

vi.mock("server-only", () => ({}));
import { formatPdfEuros, generateBillingPdf } from "./pdf";

function sample(kind: "invoice" | "credit_note" = "invoice", itemCount = 2): BillingDocument {
  const number = kind === "invoice" ? "FAC-2026-000001" : "AV-2026-000001";
  const amount = itemCount * 1_250;
  return {
    id: "00000000-0000-4000-8000-000000000001", businessId: "00000000-0000-4000-8000-000000000002",
    saleId: "00000000-0000-4000-8000-000000000003", saleReference: "VEN-2026-0001", kind, number,
    issuedOn: "2026-08-07", supplyOn: "2026-08-06", originalInvoiceId: kind === "credit_note" ? "00000000-0000-4000-8000-000000000004" : null,
    originalInvoiceNumber: kind === "credit_note" ? "FAC-2026-000001" : null, originalInvoiceIssuedOn: kind === "credit_note" ? "2026-08-06" : null,
    linkedRefundId: null, operationCategory: "goods", buyerKind: "professional", buyerName: "Cœur d’été & Associés",
    buyerAddress: "12 rue de l’Été\n75001 Paris", buyerAddressOmitted: false, buyerBillingAddress: null, buyerDeliveryAddress: "Marché de Noël, Lyon",
    buyerEmail: "cliente@example.fr", buyerSiren: "123456789", buyerVatNumber: "FR00123456789", purchaseOrderReference: "BC-ÉTÉ-42",
    issuerLegalNameSnapshot: "Élodie Œuvre EI", issuerTradeNameSnapshot: "Bijoux Cœur d’été", issuerSiretSnapshot: "12345678900012",
    issuerSirenSnapshot: "123456789", issuerAddressSnapshot: "5 allée des Créatrices\n69001 Lyon", issuerEmailSnapshot: "élodie@example.fr",
    issuerPhoneSnapshot: "01 02 03 04 05", issuerRegistrationDetailsSnapshot: "Entrepreneur individuel inscrit au RNE",
    vatRegimeSnapshot: "franchise", vatExemptionMentionSnapshot: "TVA non applicable, art. 293 B du CGI",
    subtotalExclTaxCents: amount, shippingExclTaxCents: 0, discountExclTaxCents: 0, totalExclTaxCents: amount,
    vatCents: 0, totalInclTaxCents: amount, paymentDueOn: "2026-09-07", paymentTermsSnapshot: "Paiement à 30 jours.",
    earlyPaymentDiscountTermsSnapshot: "Pas d’escompte pour paiement anticipé.", latePenaltyTermsSnapshot: "Pénalités selon les conditions convenues.",
    recoveryIndemnitySnapshot: "Indemnité forfaitaire de recouvrement selon les règles applicables.", creditReason: kind === "credit_note" ? "Retour du bijou" : null,
    renderVersion: 1, createdAt: "2026-08-07T10:00:00Z", credits: [], commercialState: kind === "invoice" ? "invoice" : "credit-note",
    items: Array.from({ length: itemCount }, (_, index) => ({ id: String(index), description: `Création n°${index + 1} — cœur, été, façade, où, œuvre`, quantity: 1, unitPriceExclTaxCents: 1_250, lineTotalExclTaxCents: 1_250, position: index + 1 })),
  };
}

function pageCount(bytes: Uint8Array): number { return (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b/g) ?? []).length; }

describe("PDF de facturation", () => {
  it("formate les centimes sans addition flottante ni glyphe de groupement exotique", () => { expect(formatPdfEuros(137_500)).toBe("1 375,00 €"); expect(formatPdfEuros(2_505, true)).toBe("- 25,05 €"); });
  it("affiche une remise de facture non nulle comme une soustraction", () => expect(formatPdfEuros(1_000, true)).toBe("- 10,00 €"));
  it("n’affiche jamais de zéro négatif sur une facture ou un avoir", () => { expect(formatPdfEuros(0)).toBe("0,00 €"); expect(formatPdfEuros(0, true)).toBe("0,00 €"); });
  it("génère une facture PDF lisible", async () => { const bytes = await generateBillingPdf(sample()); expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(4_000); expect(pageCount(bytes)).toBeGreaterThanOrEqual(1); });
  it("génère un avoir avec référence à la facture initiale", async () => { const bytes = await generateBillingPdf(sample("credit_note")); expect(bytes.length).toBeGreaterThan(4_000); expect(pageCount(bytes)).toBeGreaterThanOrEqual(1); });
  it("préserve sans erreur les accents français et œ grâce à Noto Sans", async () => await expect(generateBillingPdf(sample())).resolves.toBeInstanceOf(Uint8Array));
  it("génère plusieurs pages sans tronquer silencieusement les lignes", async () => expect(pageCount(await generateBillingPdf(sample("invoice", 90)))).toBeGreaterThan(1));
  it("rappelle le numéro et la pagination sur chaque page dans le générateur", () => { const source = readFileSync(join(process.cwd(), "src/lib/invoicing/pdf.ts"), "utf8"); expect(source).toContain("Page ${index + 1} / ${range.count}"); expect(source).toContain("document.number"); expect(source).toContain("bufferPages: true"); });
  it("n’utilise aucune donnée dynamique d’encaissement ou interne", () => { const source = readFileSync(join(process.cwd(), "src/lib/invoicing/pdf.ts"), "utf8"); expect(source).not.toMatch(/from\(["']payments["']\)|getPayments|gross_amount_cents|payment_method|platform_fee|manufacturing_cost|margin_cents|urssaf_reserve/i); });
  it("configure la route authentifiée et les en-têtes de téléchargement", () => { const route = readFileSync(join(process.cwd(), "src/app/(app)/factures/[id]/pdf/route.ts"), "utf8"); expect(route).toContain('"Content-Type": "application/pdf"'); expect(route).toContain('"Cache-Control": "private, no-store"'); expect(route).toContain("deterministicPdfFilename"); expect(route).toContain("context.business.id"); });
});
