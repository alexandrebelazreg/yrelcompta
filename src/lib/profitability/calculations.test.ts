import { describe, expect, it } from "vitest";
import { calculateProfitabilityPlan, type ProfitabilityFixedCharge } from "./calculations";

const charge = (overrides: Partial<ProfitabilityFixedCharge>): ProfitabilityFixedCharge => ({
  id: "c", description: "Abonnement", category: "software", nature: "operating", costBehavior: "fixed",
  estimatedAmountCents: 2000, professionalShareBasisPoints: 10000, frequency: "monthly", isActive: true, ...overrides,
});

const base = {
  charges: [charge({ id: "shopify" }), charge({ id: "assurance", category: "insurance", estimatedAmountCents: 12000, professionalShareBasisPoints: 5000, frequency: "yearly" })],
  equipment: [{ id: "e1", description: "Pince", purchasedOn: "2026-05-01", businessAmountCents: 60000 }],
  reference: { source: "sales" as const, revenueCents: 10000, marginCents: 6000, count: 4 },
  catalog: { priceTotalCents: 9000, productCount: 3 },
  levyRateBasisPoints: null,
};

describe("plan de rentabilité", () => {
  it("ramène les charges fixes au mois avec la part professionnelle", () => {
    const plan = calculateProfitabilityPlan(base);
    expect(plan.chargeLines.map((line) => line.monthlyCents)).toEqual([2000, 500]);
    expect(plan.recurringMonthlyCents).toBe(2500);
  });

  it("lisse le matériel des 12 derniers mois sur l’année", () => {
    const plan = calculateProfitabilityPlan(base);
    expect(plan.equipmentTotalCents).toBe(60000);
    expect(plan.equipmentMonthlyCents).toBe(5000);
    expect(plan.monthlyToCoverCents).toBe(7500);
  });

  it("calcule le seuil avec la marge de référence, arrondi au centime supérieur", () => {
    const plan = calculateProfitabilityPlan(base);
    expect(plan.marginRateBasisPoints).toBe(6000);
    expect(plan.breakEvenRevenueCents).toBe(12500);
    expect(plan.breakEvenAfterLevyCents).toBeNull();
    expect(plan.unitsPerMonth).toBe(5);
  });

  it("intègre les prélèvements proportionnels au chiffre d’affaires quand ils sont estimables", () => {
    const plan = calculateProfitabilityPlan({ ...base, levyRateBasisPoints: 1230 });
    // 75 € / (60 % − 12,3 %) = 157,2327… €
    expect(plan.breakEvenAfterLevyCents).toBe(15724);
    expect(plan.unitsPerMonth).toBe(6);
  });

  it("exclut les charges variables, fiscales, archivées et les matières premières", () => {
    const plan = calculateProfitabilityPlan({ ...base, charges: [
      charge({ id: "v", costBehavior: "variable" }),
      charge({ id: "t", nature: "tax_social", category: "taxes_social" }),
      charge({ id: "a", isActive: false }),
      charge({ id: "m", category: "raw_materials" }),
    ] });
    expect(plan.chargeLines).toEqual([]);
    expect(plan.recurringMonthlyCents).toBe(0);
  });

  it("signale l’absence de charges, de marge ou une marge insuffisante", () => {
    expect(calculateProfitabilityPlan({ ...base, charges: [], equipment: [] }).unavailableReason).toBe("no-costs");
    expect(calculateProfitabilityPlan({ ...base, reference: null }).unavailableReason).toBe("no-margin-reference");
    expect(calculateProfitabilityPlan({ ...base, reference: { ...base.reference, marginCents: 0 } }).unavailableReason).toBe("non-positive-margin");
    const levy = calculateProfitabilityPlan({ ...base, levyRateBasisPoints: 6000 });
    expect(levy.unavailableReason).toBe("levy-exceeds-margin");
    expect(levy.breakEvenRevenueCents).toBe(12500);
  });
});
