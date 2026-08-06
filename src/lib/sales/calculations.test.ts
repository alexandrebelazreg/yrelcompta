import { describe, expect, it } from "vitest";
import { calculateHistoricalManufacturingCost, calculateLineManufacturingCost, calculateManufacturingMarginAfterDiscount, calculateManufacturingMarginRate, calculateMonthlyRevenue, calculateSaleFinancials, calculateSalesTotals, calculateSaleSubtotal, calculateSaleTotal, formatEuroCents, getSaleCostingState, hasIncompleteHistoricalCost, parseFrenchMoneyToCents, toSafeIntegerAmount, type SalesTotalsSource } from "./calculations";

describe("parseFrenchMoneyToCents", () => {
  it.each([["0", 0], ["12", 1200], ["12,5", 1250], ["12,50", 1250], ["12.50", 1250], ["1 234,56", 123456]])("convertit %s", (input, expected) => expect(parseFrenchMoneyToCents(input)).toBe(expected));
  it.each(["12,345", "-1", "douze", ""])("refuse %s", (input) => expect(() => parseFrenchMoneyToCents(input)).toThrow());
  it("refuse les valeurs dépassant les entiers sûrs", () => expect(() => parseFrenchMoneyToCents("90071992547410,00")).toThrow());
  it("formate explicitement des centimes", () => expect(formatEuroCents(1250)).toBe("12,50 €"));
});

describe("coûts historiques de fabrication", () => {
  const completeItems = [
    { product_id: "p1", unit_manufacturing_cost_cents: 500, line_manufacturing_cost_cents: 1000 },
    { product_id: "p2", unit_manufacturing_cost_cents: 250, line_manufacturing_cost_cents: 250 },
  ];
  it("additionne exactement le coût historique total", () => expect(calculateHistoricalManufacturingCost(completeItems)).toBe(1250));
  it("détecte une vente au coût incomplet", () => expect(hasIncompleteHistoricalCost([...completeItems, { product_id: null, unit_manufacturing_cost_cents: null, line_manufacturing_cost_cents: null }])).toBe(true));
  it("ne renvoie jamais un total partiel", () => expect(calculateHistoricalManufacturingCost([...completeItems, { product_id: null, unit_manufacturing_cost_cents: null, line_manufacturing_cost_cents: null }])).toBeNull());
  it("accepte un coût nul", () => expect(calculateHistoricalManufacturingCost([{ product_id: "p", unit_manufacturing_cost_cents: 0, line_manufacturing_cost_cents: 0 }])).toBe(0));
  it("multiplie le coût unitaire par la quantité avec BigInt", () => expect(calculateLineManufacturingCost(3, 725)).toBe(2175));
  it("refuse une multiplication dépassant la plage sûre", () => expect(() => calculateLineManufacturingCost(Number.MAX_SAFE_INTEGER, 2)).toThrow("MONETARY_VALUE_OUT_OF_SAFE_RANGE"));
  it("calcule une marge négative après remise", () => expect(calculateManufacturingMarginAfterDiscount(1000, 200, 1200)).toBe(-400));
  it("inclut la remise dans la marge", () => expect(calculateManufacturingMarginAfterDiscount(5000, 500, 2000)).toBe(2500));
  it("calcule le taux sur les marchandises après remise", () => expect(calculateManufacturingMarginRate(5000, 500, 2250)).toBe(50));
  it("omet le taux lorsque le dénominateur est nul", () => expect(calculateManufacturingMarginRate(500, 500, -100)).toBeNull());
  it("refuse un bigint Supabase hors plage sûre", () => expect(() => toSafeIntegerAmount("9007199254740992")).toThrow("MONETARY_VALUE_OUT_OF_SAFE_RANGE"));
});

describe("état d'évaluation du coût d'une vente", () => {
  it("distingue un brouillon non évalué", () => expect(getSaleCostingState({ status: "draft", costing_evaluated: false, costing_complete: false })).toBe("draft"));
  it("distingue une ancienne vente non évaluée", () => expect(getSaleCostingState({ status: "validated", costing_evaluated: false, costing_complete: false })).toBe("historical-unassessed"));
  it("distingue une vente évaluée incomplète", () => expect(getSaleCostingState({ status: "validated", costing_evaluated: true, costing_complete: false })).toBe("evaluated-incomplete"));
  it("distingue une vente évaluée complète", () => expect(getSaleCostingState({ status: "validated", costing_evaluated: true, costing_complete: true })).toBe("evaluated-complete"));
  it("conserve l'état évalué d'une vente annulée", () => expect(getSaleCostingState({ status: "cancelled", costing_evaluated: true, costing_complete: false })).toBe("evaluated-incomplete"));
  it("rejette une vente complète non évaluée", () => expect(() => getSaleCostingState({ status: "validated", costing_evaluated: false, costing_complete: true })).toThrow("INCONSISTENT_SALE_COSTING_STATE"));
  it("rejette un brouillon marqué comme évalué", () => expect(() => getSaleCostingState({ status: "draft", costing_evaluated: true, costing_complete: false })).toThrow("INCONSISTENT_SALE_COSTING_STATE"));
});

describe("calculs d'une vente", () => {
  const items = [{ quantity: 2, unit_price_cents: 1500 }, { quantity: 1, unit_price_cents: 500 }];
  it("calcule le sous-total, la livraison et la remise", () => { expect(calculateSaleSubtotal(items)).toBe(3500); expect(calculateSaleTotal(items, 500, 200)).toBe(3800); });
  it("calcule un encaissement partiel sans déduire la commission du brut", () => {
    const result = calculateSaleFinancials({ status: "validated", total_cents: 10000, payments: [{ gross_amount_cents: 4000, platform_fee_cents: 500, refunds: [] }] });
    expect(result.grossPaidCents).toBe(4000); expect(result.netDepositedCents).toBe(3500); expect(result.remainingCents).toBe(6000);
  });
  it("calcule une vente totalement encaissée", () => expect(calculateSaleFinancials({ status: "validated", total_cents: 10000, payments: [{ gross_amount_cents: 10000, platform_fee_cents: 1200, refunds: [] }] }).remainingCents).toBe(0));
  it("ne réaugmente pas le reste avec un remboursement partiel ou total", () => {
    const partial = calculateSaleFinancials({ status: "validated", total_cents: 10000, payments: [{ gross_amount_cents: 10000, platform_fee_cents: 0, refunds: [{ amount_cents: 3000 }] }] });
    const total = calculateSaleFinancials({ status: "validated", total_cents: 10000, payments: [{ gross_amount_cents: 10000, platform_fee_cents: 0, refunds: [{ amount_cents: 10000 }] }] });
    expect(partial.refundedCents).toBe(3000); expect(partial.remainingCents).toBe(0); expect(total.netCollectedCents).toBe(0); expect(total.remainingCents).toBe(0);
  });
  it("force le reste à zéro pour une vente annulée", () => expect(calculateSaleFinancials({ status: "cancelled", total_cents: 5000, payments: [] }).remainingCents).toBe(0));
});

describe("reste global à encaisser", () => {
  const sale = (status: SalesTotalsSource["status"], totalCents: number, grossPaidCents = 0): SalesTotalsSource => ({
    status,
    total_cents: totalCents,
    payments: grossPaidCents > 0 ? [{ gross_amount_cents: grossPaidCents, platform_fee_cents: 0, refunds: [] }] : [],
  });

  it("exclut un brouillon de 100 €", () => expect(calculateSalesTotals([sale("draft", 10000)]).remainingCents).toBe(0));
  it("compte 100 € pour une vente validée non encaissée", () => expect(calculateSalesTotals([sale("validated", 10000)]).remainingCents).toBe(10000));
  it("compte 60 € pour une vente validée encaissée à hauteur de 40 €", () => expect(calculateSalesTotals([sale("validated", 10000, 4000)]).remainingCents).toBe(6000));
  it("exclut une vente annulée", () => expect(calculateSalesTotals([sale("cancelled", 10000)]).remainingCents).toBe(0));
  it("prend en compte plus de 100 ventes", () => {
    const sales = Array.from({ length: 125 }, () => sale("validated", 1000));
    const totals = calculateSalesTotals(sales);
    expect(totals.validatedSalesCents).toBe(125000);
    expect(totals.remainingCents).toBe(125000);
  });
});

describe("indicateur mensuel", () => {
  const payments = [
    { received_on: "2026-08-02", gross_amount_cents: 10000, platform_fee_cents: 1200, refunds: [{ refunded_on: "2026-08-10", amount_cents: 2500 }] },
    { received_on: "2026-07-31", gross_amount_cents: 5000, platform_fee_cents: 0, refunds: [{ refunded_on: "2026-08-04", amount_cents: 500 }] },
  ];
  it("inclut les encaissements du mois, exclut les autres et déduit les remboursements du mois", () => expect(calculateMonthlyRevenue(payments, "2026-08-01", "2026-09-01")).toBe(7000));
});
