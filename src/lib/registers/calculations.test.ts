import { describe, expect, it } from "vitest";
import type { TurnoverDeclaration } from "@/types/registers";
import {
  adjustmentReasonRequired,
  calculateDeclarationSuggestion,
  calculateRegisterTotals,
  declarationSubmittedOnMinimum,
  declarationUiStatus,
  generateDeclarationPeriods,
  latestDeclaredAnnualTotal,
  resolveRegisterYear,
  turnoverDifference,
  validateDeclarationDates,
} from "./calculations";
import { declarationSuccessMessage } from "./presentation";

function declaration(revisionNo: number, declaredTurnoverCents: number, periodStart = "2026-01-01"): TurnoverDeclaration {
  return {
    id: `00000000-0000-4000-8000-${String(revisionNo).padStart(12, "0")}`,
    businessId: "00000000-0000-4000-8000-000000000099",
    periodStart,
    periodEnd: periodStart === "2026-01-01" ? "2026-01-31" : "2026-02-28",
    dueOn: "2026-02-28",
    declarationPeriodSnapshot: "monthly",
    vatRegimeSnapshot: "franchise",
    revisionNo,
    previousDeclarationId: revisionNo === 1 ? null : "00000000-0000-4000-8000-000000000001",
    calculationStatus: "available",
    suggestedTurnoverCents: declaredTurnoverCents,
    grossReceiptsSnapshotCents: declaredTurnoverCents,
    customerRefundsSnapshotCents: 0,
    paymentCountSnapshot: 1,
    refundCountSnapshot: 0,
    declaredTurnoverCents,
    submittedOn: "2026-02-10",
    externalReference: null,
    adjustmentReason: revisionNo === 1 ? null : "Correction",
    createdAt: "2026-02-10T12:00:00Z",
    fiscalEvaluated: false,
    fiscalProfileId: null,
    fiscalRuleVersionId: null,
    acreRuleVersionId: null,
    socialRateBasisPointsSnapshot: null,
    cfpRateBasisPointsSnapshot: null,
    versementLiberatoireBasisPointsSnapshot: null,
    acreAppliedSnapshot: null,
    estimatedSocialContributionsCents: null,
    estimatedCfpCents: null,
    estimatedIncomeTaxCents: null,
    estimatedTotalReserveCents: null,
  };
}

describe("calendrier déclaratif", () => {
  it("génère la première déclaration mensuelle du 6 mars au 30 juin, échéance 31 juillet", () => {
    expect(generateDeclarationPeriods("2026-03-06", "monthly", 2026)[0]).toEqual({
      periodStart: "2026-03-06", periodEnd: "2026-06-30", dueOn: "2026-07-31",
    });
  });

  it("reprend ensuite juillet civil avec une échéance au 31 août", () => {
    expect(generateDeclarationPeriods("2026-03-06", "monthly", 2026)[1]).toEqual({
      periodStart: "2026-07-01", periodEnd: "2026-07-31", dueOn: "2026-08-31",
    });
  });

  it("génère la première déclaration trimestrielle du 12 avril au 30 septembre", () => {
    expect(generateDeclarationPeriods("2026-04-12", "quarterly", 2026)[0]).toEqual({
      periodStart: "2026-04-12", periodEnd: "2026-09-30", dueOn: "2026-10-31",
    });
  });

  it("reprend ensuite le quatrième trimestre et son échéance en janvier N+1", () => {
    expect(generateDeclarationPeriods("2026-04-12", "quarterly", 2026)[1]).toEqual({
      periodStart: "2026-10-01", periodEnd: "2026-12-31", dueOn: "2027-01-31",
    });
  });

  it("gère le changement d’année après une première période mensuelle", () => {
    const periods = generateDeclarationPeriods("2026-10-15", "monthly", 2027);
    expect(periods[0]).toEqual({ periodStart: "2026-10-15", periodEnd: "2027-01-31", dueOn: "2027-02-28" });
    expect(periods[1].periodStart).toBe("2027-02-01");
  });

  it("ne génère aucun faux calendrier sans date de début", () => {
    expect(generateDeclarationPeriods(null, "monthly", 2026)).toEqual([]);
  });

  it("résout l’année courante à Paris près de minuit", () => {
    expect(resolveRegisterYear(undefined, new Date("2025-12-31T23:30:00Z"))).toBe(2026);
    expect(resolveRegisterYear("invalide", new Date("2025-12-31T23:30:00Z"))).toBe(2026);
  });

  it("classe les périodes à venir, à déclarer, en retard et déclarées", () => {
    expect(declarationUiStatus("2026-08-31", "2026-09-30", false, "2026-08-15")).toBe("upcoming");
    expect(declarationUiStatus("2026-08-31", "2026-09-30", false, "2026-09-15")).toBe("to-declare");
    expect(declarationUiStatus("2026-08-31", "2026-09-30", false, "2026-10-01")).toBe("overdue");
    expect(declarationUiStatus("2026-08-31", "2026-09-30", true, "2026-10-01")).toBe("declared");
  });
});

describe("calcul déclaratif", () => {
  it("traite zéro euro comme une suggestion disponible", () => {
    expect(calculateDeclarationSuggestion("franchise", [], [])).toMatchObject({ calculationStatus: "available", suggestedTurnoverCents: 0 });
  });

  it("propose la somme brute en franchise sans remboursement", () => {
    expect(calculateDeclarationSuggestion("franchise", [{ grossAmountCents: 12_000 }, { grossAmountCents: 3_000 }], []).suggestedTurnoverCents).toBe(15_000);
  });

  it("ne déduit ni commissions ni dépenses du chiffre d’affaires proposé", () => {
    const result = calculateDeclarationSuggestion("franchise", [{ grossAmountCents: 10_000, platformFeeCents: 900 }], []);
    expect(result).toMatchObject({ grossReceiptsCents: 10_000, suggestedTurnoverCents: 10_000 });
  });

  it("rend la suggestion indisponible quand la TVA n’est pas modélisée", () => {
    expect(calculateDeclarationSuggestion("liable", [{ grossAmountCents: 10_000 }], [])).toMatchObject({ calculationStatus: "vat-unmodeled", suggestedTurnoverCents: null });
  });

  it("ne déduit jamais automatiquement un remboursement client", () => {
    expect(calculateDeclarationSuggestion("franchise", [{ grossAmountCents: 10_000 }], [{ amountCents: 2_000 }])).toMatchObject({
      calculationStatus: "refund-review-required", suggestedTurnoverCents: null, grossReceiptsCents: 10_000, customerRefundsCents: 2_000,
    });
  });

  it("exige un motif si la suggestion est absente ou différente", () => {
    expect(adjustmentReasonRequired(null, 10_000)).toBe(true);
    expect(adjustmentReasonRequired(10_000, 9_999)).toBe(true);
    expect(adjustmentReasonRequired(10_000, 10_000)).toBe(false);
  });

  it("refuse une période non terminée", () => {
    expect(() => validateDeclarationDates("2026-08-31", "2026-08-20", "2026-08-20")).toThrow("DECLARATION_PERIOD_NOT_ENDED");
  });

  it("accepte une date de déclaration postérieure à la fin d’une période terminée", () => {
    expect(() => validateDeclarationDates("2026-07-31", "2026-08-01", "2026-08-20")).not.toThrow();
    expect(declarationSubmittedOnMinimum("2026-07-31")).toBe("2026-08-01");
  });

  it("refuse une date de déclaration égale à la fin de période", () => {
    expect(() => validateDeclarationDates("2026-07-31", "2026-07-31", "2026-08-20")).toThrow("DECLARATION_SUBMITTED_BEFORE_PERIOD_END");
  });

  it("refuse une date de déclaration antérieure à la fin de période", () => {
    expect(() => validateDeclarationDates("2026-07-31", "2026-07-10", "2026-08-20")).toThrow("DECLARATION_SUBMITTED_BEFORE_PERIOD_END");
  });

  it("refuse une date de déclaration future", () => {
    expect(() => validateDeclarationDates("2026-07-31", "2026-08-21", "2026-08-20")).toThrow("DECLARATION_SUBMITTED_IN_FUTURE");
  });

  it("calcule l’écart en BigInt et distingue une suggestion indisponible", () => {
    expect(turnoverDifference(10_000, 9_500)).toBe(-500);
    expect(turnoverDifference(null, 9_500)).toBeNull();
  });
});

describe("messages de succès déclaratifs", () => {
  it("mappe uniquement les trois succès connus", () => {
    expect(declarationSuccessMessage("date-enregistree")).toBe("Date de début d’activité enregistrée.");
    expect(declarationSuccessMessage("declaration-enregistree")).toBe("Déclaration enregistrée dans YrelCompta.");
    expect(declarationSuccessMessage("correction-enregistree")).toBe("Correction enregistrée dans YrelCompta.");
    expect(declarationSuccessMessage("inconnu")).toBeNull();
    expect(declarationSuccessMessage(["declaration-enregistree"])).toBeNull();
  });
});

describe("totaux et révisions", () => {
  it("calcule les totaux trimestriels et annuels sur le montant choisi", () => {
    const rows = [{ date: "2026-01-10", gross: 100, business: 50 }, { date: "2026-04-10", gross: 200, business: 100 }];
    expect(calculateRegisterTotals(rows, (row) => row.date, (row) => row.gross)).toEqual({ quarterCents: [100, 200, 0, 0], annualCents: 300 });
  });

  it("agrège exactement plus de 1 000 écritures", () => {
    const rows = Array.from({ length: 1_001 }, () => ({ date: "2026-12-01", amount: 9 }));
    expect(calculateRegisterTotals(rows, (row) => row.date, (row) => row.amount).annualCents).toBe(9_009);
  });

  it("utilise uniquement la dernière révision et conserve les périodes distinctes", () => {
    const revisions = [declaration(1, 10_000), declaration(2, 12_000), declaration(1, 5_000, "2026-02-01")];
    expect(latestDeclaredAnnualTotal(revisions)).toBe(17_000);
    expect(revisions).toHaveLength(3);
    expect(revisions[1].previousDeclarationId).toBe(revisions[0].id);
  });

  it("refuse un total annuel hors plage Number sûre", () => {
    expect(() => latestDeclaredAnnualTotal([declaration(1, Number.MAX_SAFE_INTEGER), declaration(1, 1, "2026-02-01")])).toThrow("REGISTER_MONETARY_VALUE_OUT_OF_SAFE_RANGE");
  });
});
