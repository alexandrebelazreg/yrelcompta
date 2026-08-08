import { describe, expect, it } from "vitest";
import type { AcreRuleVersion, BusinessFiscalProfile, FiscalCalculationContext, FiscalSocialRuleVersion } from "@/types/fiscal-social";
import {
  calculateAcreEndDate,
  calculateDashboardFiscalReserve,
  calculateFiscalReserve,
  resolveVersionAtDate,
  roundFiscalAmount,
  roundRateUpToIncrement,
} from "./calculations";

const rule: FiscalSocialRuleVersion = {
  id: "rule-2026", effectiveFrom: "2026-01-01", activityCategory: "micro_bic_goods",
  socialContributionBasisPoints: 1230, cfpCommercialBasisPoints: 10, cfpArtisanBasisPoints: 30,
  versementLiberatoireBasisPoints: 100, incomeTaxAbatementBasisPoints: 7100,
  microTurnoverCeilingCents: 20_310_000, vatFranchiseBaseCeilingCents: 8_500_000,
  vatFranchiseToleranceCeilingCents: 9_350_000, sourceLabel: "Règle 2026", sourceCheckedOn: "2026-08-08",
};
const oldAcre: AcreRuleVersion = {
  id: "acre-old", activityStartedFrom: "0001-01-01", paidFractionBasisPoints: 5000,
  durationQuartersAfterStart: 3, rateRoundingIncrementBasisPoints: 10,
  sourceLabel: "Ancienne ACRE", sourceCheckedOn: "2026-08-08",
};
const newAcre: AcreRuleVersion = { ...oldAcre, id: "acre-new", activityStartedFrom: "2026-07-01", paidFractionBasisPoints: 7500 };
const profile = (overrides: Partial<BusinessFiscalProfile> = {}): BusinessFiscalProfile => ({
  id: "profile", businessId: "business", effectiveFrom: "2026-01-01", cfpCategory: "commercial",
  hasAcre: false, versementLiberatoire: false, createdAt: "2026-01-01T00:00:00Z", ...overrides,
});

describe("calcul fiscal et social entier", () => {
  it("applique le taux normal vente de 12,30 % et la CFP commerciale de 0,10 %", () => {
    const result = calculateFiscalReserve(100_000, "2026-08-31", "2026-01-01", profile(), rule, null);
    expect(result).toMatchObject({ socialRateBasisPoints: 1230, cfpRateBasisPoints: 10, estimatedSocialContributionsCents: 12_300, estimatedCfpCents: 100 });
  });

  it("applique la CFP artisanale de 0,30 %", () => {
    expect(calculateFiscalReserve(100_000, "2026-08-31", "2026-01-01", profile({ cfpCategory: "artisan" }), rule, null).estimatedCfpCents).toBe(300);
  });

  it("ajoute le versement libératoire de 1 % uniquement si activé", () => {
    expect(calculateFiscalReserve(100_000, "2026-08-31", "2026-01-01", profile(), rule, null).estimatedIncomeTaxCents).toBe(0);
    expect(calculateFiscalReserve(100_000, "2026-08-31", "2026-01-01", profile({ versementLiberatoire: true }), rule, null).estimatedIncomeTaxCents).toBe(1_000);
  });

  it("arrondit l’ancienne ACRE au dixième supérieur, soit 6,20 %", () => {
    const result = calculateFiscalReserve(100_000, "2026-12-31", "2026-06-30", profile({ hasAcre: true }), rule, oldAcre);
    expect(result).toMatchObject({ socialRateBasisPoints: 620, acreApplied: true, estimatedSocialContributionsCents: 6_200 });
  });

  it("arrondit la nouvelle ACRE au dixième supérieur, soit 9,30 %", () => {
    const result = calculateFiscalReserve(100_000, "2026-12-31", "2026-07-01", profile({ hasAcre: true }), rule, newAcre);
    expect(result).toMatchObject({ socialRateBasisPoints: 930, acreApplied: true, estimatedSocialContributionsCents: 9_300 });
    expect(roundRateUpToIncrement(1230, 7500, 10)).toBe(930);
  });

  it.each([
    ["2026-07-01", "2027-06-30"],
    ["2026-09-21", "2027-06-30"],
    ["2026-10-05", "2027-09-30"],
  ])("termine l’ACRE de %s le %s", (start, expected) => {
    expect(calculateAcreEndDate(start, 3)).toBe(expected);
  });

  it("revient au taux normal après la fin de l’ACRE", () => {
    const result = calculateFiscalReserve(100_000, "2027-07-01", "2026-07-01", profile({ hasAcre: true }), rule, newAcre);
    expect(result).toMatchObject({ socialRateBasisPoints: 1230, acreApplied: false });
  });

  it("ne réduit jamais la CFP ni le versement libératoire avec l’ACRE", () => {
    const result = calculateFiscalReserve(100_000, "2026-12-31", "2026-07-01", profile({ hasAcre: true, cfpCategory: "artisan", versementLiberatoire: true }), rule, newAcre);
    expect(result).toMatchObject({ cfpRateBasisPoints: 30, versementLiberatoireBasisPoints: 100, estimatedCfpCents: 300, estimatedIncomeTaxCents: 1_000 });
  });

  it("conserve une arithmétique BigInt exacte jusqu’à la conversion sûre", () => {
    expect(roundFiscalAmount(BigInt("9007199254700000"), BigInt(1230))).toBe(1_107_885_508_328_100);
    expect(() => roundFiscalAmount(BigInt("9007199254740992"), BigInt(1230))).toThrow("FISCAL_MONETARY_VALUE_OUT_OF_SAFE_RANGE");
  });

  it("résout la dernière version applicable sans dépendre de l’ordre d’entrée", () => {
    const versions = [profile({ id: "2027", effectiveFrom: "2027-01-01" }), profile({ id: "2026", effectiveFrom: "2026-01-01" })];
    expect(resolveVersionAtDate(versions, "2026-12-31", (item) => item.effectiveFrom)?.id).toBe("2026");
    expect(resolveVersionAtDate(versions, "2025-12-31", (item) => item.effectiveFrom)).toBeNull();
  });
});

describe("réserve du tableau de bord", () => {
  const context = (overrides: Partial<FiscalCalculationContext> = {}): FiscalCalculationContext => ({
    activityStartedOn: "2026-01-01", vatRegime: "franchise", profile: profile(), rule, acreRule: oldAcre, ...overrides,
  });
  const calculate = (overrides: Partial<Parameters<typeof calculateDashboardFiscalReserve>[0]> = {}) => calculateDashboardFiscalReserve({
    grossCollectedCents: 100_000, customerRefundCount: 0, trackedCashCents: 80_000,
    calculationDate: "2026-08-31", context: context(), ...overrides,
  });

  it("calcule une réserve complète et le flux suivi après réserve", () => {
    expect(calculate()).toMatchObject({ unavailableReason: null, trackedCashAfterReserveCents: 67_600, calculation: { estimatedTotalReserveCents: 12_400 } });
  });

  it("n’affiche aucun montant partiel avec remboursement", () => {
    expect(calculate({ customerRefundCount: 1 })).toEqual({ calculation: null, unavailableReason: "refund-review-required", trackedCashAfterReserveCents: null });
  });

  it("n’affiche aucun montant partiel pour la TVA liable", () => {
    expect(calculate({ context: context({ vatRegime: "liable" }) })).toMatchObject({ calculation: null, unavailableReason: "vat-unmodeled" });
  });

  it("demande la configuration lorsqu’aucun profil n’est applicable", () => {
    expect(calculate({ context: context({ profile: null }) })).toMatchObject({ calculation: null, unavailableReason: "profile-not-configured" });
  });
});
