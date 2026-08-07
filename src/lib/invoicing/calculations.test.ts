import { describe, expect, it } from "vitest";
import { billingCommercialState, deterministicPdfFilename, formatDocumentNumber, sumInvoiceCents } from "./calculations";

describe("calculs de facturation exacts", () => {
  it("génère la première facture annuelle", () => expect(formatDocumentNumber("invoice", 2026, BigInt(1))).toBe("FAC-2026-000001"));
  it("génère la facture suivante", () => expect(formatDocumentNumber("invoice", 2026, BigInt(2))).toBe("FAC-2026-000002"));
  it("repart à 1 avec l’année fournie", () => expect(formatDocumentNumber("invoice", 2027, BigInt(1))).toBe("FAC-2027-000001"));
  it("utilise une série d’avoir indépendante", () => expect(formatDocumentNumber("credit_note", 2026, BigInt(1))).toBe("AV-2026-000001"));
  it("calcule les états commerciaux sans flottant", () => {
    expect(billingCommercialState("invoice", 10_000, 0)).toBe("invoice");
    expect(billingCommercialState("invoice", 10_000, 1)).toBe("partially-credited");
    expect(billingCommercialState("invoice", 10_000, 10_000)).toBe("fully-credited");
    expect(billingCommercialState("credit_note", 5_000, 0)).toBe("credit-note");
  });
  it("somme en BigInt", () => expect(sumInvoiceCents(["9007199254740000", 500, BigInt(490)])).toBe(9_007_199_254_740_990));
  it("refuse une conversion hors plage sûre", () => expect(() => sumInvoiceCents([Number.MAX_SAFE_INTEGER, 1])).toThrow("INVOICING_MONETARY_VALUE_OUT_OF_SAFE_RANGE"));
  it("produit les noms PDF déterministes", () => {
    expect(deterministicPdfFilename("invoice", "FAC-2026-000001")).toBe("facture-FAC-2026-000001.pdf");
    expect(deterministicPdfFilename("credit_note", "AV-2026-000001")).toBe("avoir-AV-2026-000001.pdf");
  });
});
