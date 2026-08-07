import { describe, expect, it } from "vitest";
import { createCsv, formatCentsForCsv, protectCsvFormula } from "./csv";

describe("export CSV sûr", () => {
  it("échappe le séparateur, les guillemets et les retours ligne", () => {
    const csv = createCsv(["Colonne"], [["a;b"], ['dit "bonjour"'], ["ligne 1\nligne 2"]]);
    expect(csv).toContain('"a;b"');
    expect(csv).toContain('"dit ""bonjour"""');
    expect(csv).toContain('"ligne 1\nligne 2"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it.each(["=1+1", "+CMD", "-2+3", "@SUM(A1)", "   =HYPERLINK()"])("neutralise la formule %s", (value) => {
    expect(protectCsvFormula(value)).toBe(`'${value}`);
  });

  it("ne modifie pas un texte ordinaire", () => expect(protectCsvFormula("Marché de Noël")).toBe("Marché de Noël"));

  it("produit un ordre identique à celui fourni", () => {
    const csv = createCsv(["Valeur"], [["premier"], ["second"]]);
    expect(csv.indexOf("premier")).toBeLessThan(csv.indexOf("second"));
  });

  it("exporte et protège séparément les références fournisseur et paiement", () => {
    const csv = createCsv(
      ["Référence fournisseur / justificatif", "Référence du paiement"],
      [["=FACTURE-42", "+VIREMENT-7"]],
    );
    expect(csv).toContain('"Référence fournisseur / justificatif";"Référence du paiement"');
    expect(csv).toContain('"\'=FACTURE-42";"\'+VIREMENT-7"');
  });

  it("formate les centimes sans flottant", () => {
    expect(formatCentsForCsv(12_345)).toBe("123,45");
    expect(formatCentsForCsv(0)).toBe("0,00");
  });
});
