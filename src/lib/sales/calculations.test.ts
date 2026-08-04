import { describe, expect, it } from "vitest";
import { calculateMonthlyRevenue, calculateSaleFinancials, calculateSaleSubtotal, calculateSaleTotal, formatEuroCents, parseFrenchMoneyToCents } from "./calculations";

describe("parseFrenchMoneyToCents", () => {
  it.each([["0", 0], ["12", 1200], ["12,5", 1250], ["12,50", 1250], ["12.50", 1250], ["1 234,56", 123456]])("convertit %s", (input, expected) => expect(parseFrenchMoneyToCents(input)).toBe(expected));
  it.each(["12,345", "-1", "douze", ""])("refuse %s", (input) => expect(() => parseFrenchMoneyToCents(input)).toThrow());
  it("refuse les valeurs dépassant les entiers sûrs", () => expect(() => parseFrenchMoneyToCents("90071992547410,00")).toThrow());
  it("formate explicitement des centimes", () => expect(formatEuroCents(1250)).toBe("12,50 €"));
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

describe("indicateur mensuel", () => {
  const payments = [
    { received_on: "2026-08-02", gross_amount_cents: 10000, platform_fee_cents: 1200, refunds: [{ refunded_on: "2026-08-10", amount_cents: 2500 }] },
    { received_on: "2026-07-31", gross_amount_cents: 5000, platform_fee_cents: 0, refunds: [{ refunded_on: "2026-08-04", amount_cents: 500 }] },
  ];
  it("inclut les encaissements du mois, exclut les autres et déduit les remboursements du mois", () => expect(calculateMonthlyRevenue(payments, "2026-08-01", "2026-09-01")).toBe(7000));
});
