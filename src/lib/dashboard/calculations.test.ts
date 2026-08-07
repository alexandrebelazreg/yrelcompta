import { describe, expect, it } from "vitest";
import type { DashboardRecurringTemplate, DashboardSaleCosting, DashboardSourceData } from "@/types/dashboard";
import { calculateDashboardMetrics, resolveDashboardMonth } from "./calculations";

const completeSale = (revenue = 30_000, cost = 20_000): DashboardSaleCosting => ({
  status: "validated",
  subtotalCents: revenue,
  shippingCents: 0,
  discountCents: 0,
  manufacturingCostCents: cost,
  manufacturingMarginCents: revenue - cost,
  costingComplete: true,
  costingEvaluated: true,
});

const template = (overrides: Partial<DashboardRecurringTemplate> = {}): DashboardRecurringTemplate => ({
  category: "software",
  nature: "operating",
  costBehavior: "fixed",
  estimatedAmountCents: 10_000,
  professionalShareBasisPoints: 10_000,
  frequency: "monthly",
  isActive: true,
  ...overrides,
});

const source = (overrides: Partial<DashboardSourceData> = {}): DashboardSourceData => ({
  payments: [],
  customerRefunds: [],
  expensePayments: [],
  expenseRefunds: [],
  monthlySales: [],
  referenceSales: [],
  recurringTemplates: [],
  missingDocuments: [],
  recentSales: [],
  ...overrides,
});

describe("mois du tableau de bord", () => {
  it("accepte un mois strict et calcule la fenêtre de référence de 90 jours", () => {
    expect(resolveDashboardMonth("2026-08")).toMatchObject({
      key: "2026-08",
      start: "2026-08-01",
      end: "2026-09-01",
      referenceStart: "2026-06-03",
      label: "août 2026",
    });
  });

  it("retombe sur le mois de Paris pour une valeur absente ou invalide", () => {
    const now = new Date("2026-07-31T22:30:00Z");
    expect(resolveDashboardMonth(undefined, now).key).toBe("2026-08");
    expect(resolveDashboardMonth("2026-13", now).key).toBe("2026-08");
    expect(resolveDashboardMonth(["2026-07"], now).key).toBe("2026-08");
  });

  it("gère décembre sans dépendre du fuseau de la machine", () => {
    expect(resolveDashboardMonth("2026-12")).toMatchObject({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("gère janvier et février d’une année bissextile", () => {
    expect(resolveDashboardMonth("2027-01")).toMatchObject({ start: "2027-01-01", end: "2027-02-01" });
    expect(resolveDashboardMonth("2028-02")).toMatchObject({ start: "2028-02-01", end: "2028-03-01" });
  });
});

describe("indicateurs du tableau de bord", () => {
  it("sépare les flux de trésorerie et ne duplique pas les commissions en dépenses", () => {
    const metrics = calculateDashboardMetrics(source({
      payments: [{ grossAmountCents: 15_000, platformFeeCents: 500 }],
      customerRefunds: [{ amountCents: 2_000 }],
      expensePayments: [{ businessAmountCents: 3_000 }],
      expenseRefunds: [{ businessAmountCents: 500 }],
    }));
    expect(metrics.cash).toEqual({
      grossCollectedCents: 15_000,
      customerRefundedCents: 2_000,
      revenueCollectedCents: 13_000,
      platformFeesCents: 500,
      expensesPaidCents: 3_000,
      expenseRefundedCents: 500,
      netExpensesCents: 2_500,
      trackedCashCents: 10_000,
    });
  });

  it("autorise un flux net suivi négatif", () => {
    const metrics = calculateDashboardMetrics(source({
      payments: [{ grossAmountCents: 1_000, platformFeeCents: 200 }],
      expensePayments: [{ businessAmountCents: 2_000 }],
    }));
    expect(metrics.cash.trackedCashCents).toBe(-1_200);
  });

  it("agrège uniquement les snapshots complets et distingue les deux manques de coût", () => {
    const metrics = calculateDashboardMetrics(source({ monthlySales: [
      completeSale(20_000, 8_000),
      { ...completeSale(), costingComplete: false, manufacturingCostCents: null, manufacturingMarginCents: null },
      { ...completeSale(), costingComplete: false, costingEvaluated: false, manufacturingCostCents: null, manufacturingMarginCents: null },
    ] }));
    expect(metrics.profitability).toEqual({
      saleCount: 3,
      completeCount: 1,
      incompleteCount: 1,
      historicalCount: 1,
      completeMerchandiseRevenueCents: 20_000,
      manufacturingCostCents: 8_000,
      manufacturingMarginCents: 12_000,
      marginRateBasisPoints: 6_000,
    });
  });

  it("exclut les ventes annulées et la livraison, tout en incluant la remise", () => {
    const discounted = { ...completeSale(20_000, 7_000), subtotalCents: 22_000, discountCents: 2_000, shippingCents: 5_000 };
    const cancelled = { ...completeSale(50_000, 10_000), status: "cancelled" as const };
    const metrics = calculateDashboardMetrics(source({ monthlySales: [discounted, cancelled] }));
    expect(metrics.profitability).toMatchObject({
      saleCount: 1,
      completeCount: 1,
      completeMerchandiseRevenueCents: 20_000,
      manufacturingCostCents: 7_000,
      manufacturingMarginCents: 13_000,
    });
  });

  it("exclut les modèles non actifs, non fixes, non exploitation et les catégories de production ou sociales", () => {
    const metrics = calculateDashboardMetrics(source({ recurringTemplates: [
      template(),
      template({ isActive: false }),
      template({ costBehavior: "variable" }),
      template({ costBehavior: "exceptional" }),
      template({ nature: "investment" }),
      template({ nature: "tax_social" }),
      template({ category: "raw_materials" }),
      template({ category: "packaging" }),
      template({ category: "taxes_social" }),
    ] }));
    expect(metrics.fixedCosts).toEqual({ eligibleTemplateCount: 1, monthlyCents: 10_000, annualCents: 120_000 });
  });

  it("applique la part professionnelle, annualise chaque fréquence et arrondit une seule fois le mois", () => {
    const metrics = calculateDashboardMetrics(source({ recurringTemplates: [
      template({ estimatedAmountCents: 10_000, professionalShareBasisPoints: 5_000 }),
      template({ estimatedAmountCents: 12_000, frequency: "quarterly" }),
      template({ estimatedAmountCents: 12_000, frequency: "yearly" }),
    ] }));
    expect(metrics.fixedCosts).toEqual({ eligibleTemplateCount: 3, annualCents: 120_000, monthlyCents: 10_000 });
  });

  it("reprend l’arrondi au centime de la part professionnelle du module Dépenses", () => {
    const metrics = calculateDashboardMetrics(source({ recurringTemplates: [
      template({ estimatedAmountCents: 1, professionalShareBasisPoints: 5_000 }),
    ] }));
    expect(metrics.fixedCosts).toEqual({ eligibleTemplateCount: 1, annualCents: 12, monthlyCents: 1 });
  });

  it("annualise respectivement un modèle mensuel, trimestriel et annuel", () => {
    expect(calculateDashboardMetrics(source({ recurringTemplates: [template({ estimatedAmountCents: 100 })] })).fixedCosts.annualCents).toBe(1_200);
    expect(calculateDashboardMetrics(source({ recurringTemplates: [template({ estimatedAmountCents: 100, frequency: "quarterly" })] })).fixedCosts.annualCents).toBe(400);
    expect(calculateDashboardMetrics(source({ recurringTemplates: [template({ estimatedAmountCents: 100, frequency: "yearly" })] })).fixedCosts.annualCents).toBe(100);
  });

  it("somme les équivalents annuels avant l’unique division mensuelle", () => {
    const quarterlyCent = template({ estimatedAmountCents: 1, frequency: "quarterly" });
    const metrics = calculateDashboardMetrics(source({ recurringTemplates: [quarterlyCent, quarterlyCent, quarterlyCent] }));
    expect(metrics.fixedCosts).toEqual({ eligibleTemplateCount: 3, annualCents: 12, monthlyCents: 1 });
  });

  it("calcule le seuil par plafond entier avec la marge pondérée des 90 jours", () => {
    const metrics = calculateDashboardMetrics(source({
      monthlySales: [completeSale(10_000, 4_000)],
      referenceSales: [completeSale(20_000, 15_000), completeSale(10_001, 5_000)],
      recurringTemplates: [template()],
    }));
    expect(metrics.reference).toMatchObject({
      saleCount: 2,
      merchandiseRevenueCents: 30_001,
      manufacturingMarginCents: 10_001,
    });
    expect(metrics.breakEven).toEqual({ monthlyRevenueCents: 29_999, unavailableReason: null });
    expect(metrics.fixedCostCoverageDeltaCents).toBe(-4_000);
  });

  it("conserve un taux et une marge négatifs sans rendre disponible le seuil", () => {
    const loss = completeSale(10_000, 12_000);
    const metrics = calculateDashboardMetrics(source({ monthlySales: [loss], referenceSales: [loss], recurringTemplates: [template()] }));
    expect(metrics.profitability.marginRateBasisPoints).toBe(-2_000);
    expect(metrics.breakEven).toEqual({ monthlyRevenueCents: null, unavailableReason: "non-positive-reference-margin" });
  });

  it("utilise un taux pondéré par le chiffre d’affaires et non une moyenne simple", () => {
    const metrics = calculateDashboardMetrics(source({
      referenceSales: [completeSale(10_000, 0), completeSale(90_000, 81_000)],
      recurringTemplates: [template()],
    }));
    expect(metrics.reference.marginRateBasisPoints).toBe(1_900);
  });

  it("explique séparément l’absence de charges fixes et l’absence de ventes de référence", () => {
    expect(calculateDashboardMetrics(source({ referenceSales: [completeSale()] })).breakEven.unavailableReason)
      .toBe("fixed-costs-not-configured");
    expect(calculateDashboardMetrics(source({ recurringTemplates: [template()] })).breakEven.unavailableReason)
      .toBe("no-reference-sales");
  });

  it("rend le seuil indisponible pour une marge de référence nulle", () => {
    const metrics = calculateDashboardMetrics(source({ referenceSales: [completeSale(10_000, 10_000)], recurringTemplates: [template()] }));
    expect(metrics.breakEven).toEqual({ monthlyRevenueCents: null, unavailableReason: "non-positive-reference-margin" });
  });

  it("distingue un revenu de référence non positif", () => {
    const metrics = calculateDashboardMetrics(source({ referenceSales: [completeSale(0, 0)], recurringTemplates: [template()] }));
    expect(metrics.breakEven).toEqual({ monthlyRevenueCents: null, unavailableReason: "non-positive-reference-revenue" });
  });

  it("masque l’écart de couverture dès qu’une vente mensuelle est incomplète", () => {
    const incomplete = { ...completeSale(), costingComplete: false, manufacturingCostCents: null, manufacturingMarginCents: null };
    expect(calculateDashboardMetrics(source({ monthlySales: [completeSale(), incomplete], recurringTemplates: [template()] })).fixedCostCoverageDeltaCents)
      .toBeNull();
  });

  it("affiche aussi un écart de couverture positif", () => {
    const metrics = calculateDashboardMetrics(source({ monthlySales: [completeSale(30_000, 10_000)], recurringTemplates: [template()] }));
    expect(metrics.fixedCostCoverageDeltaCents).toBe(10_000);
  });

  it("compte les justificatifs manquants parmi plus de 1 000 lignes", () => {
    const missingDocuments = Array.from({ length: 1_005 }, (_, index) => ({ documentCount: index % 5 === 0 ? 1 : 0 }));
    expect(calculateDashboardMetrics(source({ missingDocuments })).missingDocumentCount).toBe(804);
  });

  it("agrège exactement plus de 1 000 flux puis refuse un résultat hors plage sûre", () => {
    const payments = Array.from({ length: 1_005 }, () => ({ grossAmountCents: 9, platformFeeCents: 1 }));
    expect(calculateDashboardMetrics(source({ payments })).cash.trackedCashCents).toBe(8_040);
    expect(() => calculateDashboardMetrics(source({ payments: [
      { grossAmountCents: Number.MAX_SAFE_INTEGER, platformFeeCents: 0 },
      { grossAmountCents: 1, platformFeeCents: 0 },
    ] }))).toThrow("DASHBOARD_MONETARY_VALUE_OUT_OF_SAFE_RANGE");
  });

  it("refuse un snapshot marqué complet mais incohérent", () => {
    expect(() => calculateDashboardMetrics(source({ monthlySales: [{
      ...completeSale(), manufacturingMarginCents: 1,
    }] }))).toThrow("DASHBOARD_INCONSISTENT_COSTING");
  });
});
