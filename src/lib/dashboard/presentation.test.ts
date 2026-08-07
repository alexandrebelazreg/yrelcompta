import { describe, expect, it } from "vitest";
import { fixedCostCoverageMessage } from "./presentation";

describe("présentation de l’écart de couverture", () => {
  it("explique l’absence de charges fixes", () => {
    expect(fixedCostCoverageMessage("fixed-costs-not-configured"))
      .toBe("Configurez vos charges récurrentes fixes pour calculer l’écart de couverture.");
  });

  it("explique l’absence de ventes mensuelles", () => {
    expect(fixedCostCoverageMessage("no-monthly-sales"))
      .toBe("Aucune vente validée sur ce mois pour calculer l’écart de couverture.");
  });

  it("explique la couverture historique incomplète", () => {
    expect(fixedCostCoverageMessage("incomplete-monthly-costing"))
      .toBe("Écart indisponible tant que toutes les ventes du mois ne disposent pas d’un coût historique complet.");
  });

  it("décrit la formule lorsque l’écart est disponible", () => {
    expect(fixedCostCoverageMessage(null))
      .toBe("Marge de fabrication moins charges fixes récurrentes estimées. Ce montant n’intègre pas encore cotisations, fiscalité ni tous les frais commerciaux.");
  });
});
