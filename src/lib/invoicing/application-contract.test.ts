import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const newInvoice = read("src/app/(app)/factures/nouvelle/page.tsx");
const detail = read("src/app/(app)/factures/[id]/page.tsx");
const documents = read("src/app/(app)/documents/page.tsx");
const queries = read("src/lib/invoicing/queries.ts");
const actions = read("src/lib/invoicing/actions.ts");
const pdf = read("src/lib/invoicing/pdf.ts");
const packageJson = read("package.json");

describe("contrat applicatif de facturation", () => {
  it("utilise PDFKit pur côté serveur avec une police Unicode", () => { expect(packageJson).toContain('"pdfkit"'); expect(packageJson).toContain('"@fontsource/noto-sans"'); expect(pdf).toContain("noto-sans-latin-400-normal.woff"); });
  it("affiche le garde-fou e-facture réglementaire", () => expect(read("src/app/(app)/factures/page.tsx")).toContain("n’est pas, à lui seul, une facture électronique"));
  it("présente le numéro comme attribué à l’émission", () => expect(newInvoice).toContain("attribué lors de l’émission"));
  it("fait confirmer le type d’opération avec goods seulement préselectionné", () => { expect(newInvoice).toContain('defaultValue="goods"'); expect(newInvoice).toContain("operationCategory"); });
  it("ne propose l’émission que pour une vente validée", () => { expect(newInvoice).toContain('data.sale.status === "validated"'); expect(newInvoice).toContain("Validez la vente avant"); expect(newInvoice).toContain("vente annulée"); });
  it("affiche la confirmation d’immutabilité avant émission", () => expect(newInvoice).toContain("Toute correction monétaire devra ensuite passer par un avoir"));
  it("n’offre aucune action modifier ou supprimer sur un document", () => { expect(detail).not.toMatch(/Modifier la facture|Supprimer la facture|Modifier l’avoir|Supprimer l’avoir/); });
  it("distingue l’avoir du remboursement", () => expect(detail).toContain("L’avoir corrige la facture. Le remboursement représente le mouvement financier"));
  it("affiche les remboursements liés et non liés", () => { expect(detail).toContain("Lié à un avoir"); expect(detail).toContain("Non lié"); });
  it("pagine les lignes, avoirs et remboursements du détail", () => {
    const detailQueries = queries.slice(queries.indexOf("export async function getBillingDocument"), queries.indexOf("export async function getInvoiceForSale"));
    expect(detailQueries.match(/loadAllBillingPages/g)).toHaveLength(3);
    expect(detailQueries.match(/\.range\(from, to\)/g)).toHaveLength(3);
  });
  it("pagine réellement les avoirs de getInvoiceForSale", () => {
    const saleQueries = queries.slice(queries.indexOf("export async function getInvoiceForSale"), queries.indexOf("export async function getInvoiceCreationData"));
    expect(saleQueries.match(/loadAllBillingPages/g)).toHaveLength(1);
    expect(saleQueries.match(/\.range\(from, to\)/g)).toHaveLength(1);
    expect(queries).toContain("BILLING_DATA_LOAD_FAILED");
  });
  it("exige et explique le SIREN du client professionnel sans le rendre obligatoire pour le particulier", () => {
    expect(actions).toContain('value.buyerKind === "professional"');
    expect(actions).toContain("PROFESSIONAL_BUYER_SIREN_REQUIRED");
    expect(newInvoice).toContain("SIREN client — obligatoire pour un professionnel");
    expect(newInvoice).not.toMatch(/name="buyerSiren"[^>]*required/);
  });
  it("rend la remise négative sans modifier les montants persistés", () => {
    expect(pdf).toContain('totalLine("Remise", document.discountExclTaxCents, false, credit || document.discountExclTaxCents > 0)');
    expect(pdf).toContain('negative && absolute !== 0 ? "- " : ""');
  });
  it("garde les documents clients sans signed URL", () => { const clientSection = documents.slice(documents.indexOf("Documents clients"), documents.indexOf("Justificatifs fournisseurs")); expect(clientSection).not.toContain("signedUrl"); expect(clientSection).toContain("/pdf"); });
  it("conserve les justificatifs fournisseurs et leurs liens temporaires", () => { expect(documents).toContain("Justificatifs fournisseurs"); expect(documents).toContain("document.signedUrl"); expect(documents).toContain("expirent après une minute"); });
  it("ajoute Factures près de Ventes dans la navigation", () => { const nav = read("src/components/layout/navigation.tsx"); expect(nav.indexOf('"Ventes"')).toBeLessThan(nav.indexOf('"Factures"')); });
  it("ne crée automatiquement ni paiement ni remboursement dans les actions", () => expect(actions).not.toMatch(/record_payment|record_refund/));
});
