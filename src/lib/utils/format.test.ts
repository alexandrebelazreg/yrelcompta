import { describe, expect, it } from "vitest";
import { formatEuro, formatFrenchDate } from "./format";

describe("formatEuro", () => {
  it("formate zéro", () => expect(formatEuro(0)).toBe("0,00 €"));
  it("formate un montant positif", () => expect(formatEuro(1234.5)).toBe("1 234,50 €"));
  it("formate un montant négatif", () => expect(formatEuro(-42.1)).toBe("-42,10 €"));
});

describe("formatFrenchDate", () => {
  it("formate une date française", () => {
    expect(formatFrenchDate("2026-01-15T12:00:00Z")).toBe("15/01/2026");
  });
});
