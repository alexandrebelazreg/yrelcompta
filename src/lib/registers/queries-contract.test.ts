import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const queries = readFileSync(join(root, "src/lib/registers/queries.ts"), "utf8");
const revenuePage = readFileSync(join(root, "src/app/(app)/registres/recettes/page.tsx"), "utf8");
const purchasePage = readFileSync(join(root, "src/app/(app)/registres/achats/page.tsx"), "utf8");
const revenueExport = readFileSync(join(root, "src/app/(app)/registres/recettes/export/route.ts"), "utf8");
const purchaseExport = readFileSync(join(root, "src/app/(app)/registres/achats/export/route.ts"), "utf8");

describe("contrat des registres", () => {
  it("pagine toutes les lectures à volume variable", () => {
    expect(queries.match(/loadAllRegisterPages/g)?.length).toBeGreaterThanOrEqual(8);
    expect(queries).toContain("REGISTER_DATA_LOAD_FAILED");
  });

  it("trie les registres de façon stable par date, création et identifiant", () => {
    expect(queries).toContain('.order("received_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true })');
    expect(queries).toContain('.order("paid_on", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true })');
  });

  it("utilise le brut des recettes et garde les commissions séparées", () => {
    expect(queries).toContain("gross_amount_cents,platform_fee_cents");
    expect(revenuePage).toContain("entry.grossAmountCents");
    expect(revenuePage).toContain("entry.platformFeeCents");
    expect(revenuePage).toContain('entry.method === "cash"');
  });

  it("conserve les paiements historiques des dépenses validées ou annulées", () => {
    expect(queries).toContain('.in("expenses.status", ["validated", "cancelled"])');
    expect(purchasePage).toContain("entry.amountCents");
    expect(purchasePage).toContain("entry.businessAmountCents");
    expect(purchasePage).toContain("ne constitue pas une déduction fiscale");
  });

  it("sépare la référence fournisseur de la référence du paiement", () => {
    expect(queries).toContain("expenses!inner(reference,description,status,external_reference)");
    expect(queries).toContain("supplierReference: expense.external_reference");
    expect(queries).toContain("paymentReference: value.external_reference");
    expect(purchasePage).toContain("Référence fournisseur / justificatif");
    expect(purchasePage).toContain("entry.supplierReference");
    expect(purchasePage).toContain("entry.paymentReference");
    expect(purchaseExport).toContain("Référence fournisseur / justificatif");
    expect(purchaseExport).toContain("Référence du paiement");
    expect(purchaseExport).toContain("entry.supplierReference");
    expect(purchaseExport).toContain("entry.paymentReference");
  });

  it("présente les remboursements clients et fournisseurs séparément", () => {
    expect(revenuePage).toContain("Remboursements clients");
    expect(purchasePage).toContain("Avoirs et remboursements fournisseurs");
  });

  it("n’exporte aucune donnée Storage, secret ou identifiant auth", () => {
    for (const route of [revenueExport, purchaseExport]) {
      expect(route).not.toMatch(/signedUrl|storage_path|created_by|user_id|secret/i);
      expect(route).toContain("Content-Disposition");
      expect(route).toContain("text/csv; charset=utf-8");
    }
  });
});
