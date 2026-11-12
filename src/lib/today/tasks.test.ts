import { describe, expect, it } from "vitest";
import { dailyCollectedCents, fixedCostCoveragePercent } from "@/lib/dashboard/calculations";
import { pendingDeclarationPeriods } from "@/lib/registers/calculations";
import type { DashboardMetrics } from "@/types/dashboard";
import { buildTodayTasks, formatTodayLabel } from "./tasks";

const empty = { draftSaleCount: 0, draftExpenseCount: 0, recurringDraftCount: 0, missingDocumentCount: 0, pendingDeclarations: [] };

describe("liste « À faire »", () => {
  it("est vide quand tout est à jour", () => {
    expect(buildTodayTasks(empty)).toEqual([]);
  });

  it("classe les tâches de la plus urgente à la moins urgente", () => {
    const tasks = buildTodayTasks({
      draftSaleCount: 1, draftExpenseCount: 2, recurringDraftCount: 3, missingDocumentCount: 4,
      pendingDeclarations: [
        { periodStart: "2026-07-01", periodEnd: "2026-09-30", dueOn: "2026-10-31", status: "overdue" },
        { periodStart: "2026-04-01", periodEnd: "2026-06-30", dueOn: "2026-07-31", status: "overdue" },
      ],
    });
    expect(tasks.map((task) => task.id)).toEqual([
      "declaration-2026-04-01", "declaration-2026-07-01", "draft-sales", "recurring-drafts", "draft-expenses", "missing-documents",
    ]);
    expect(tasks[0].tone).toBe("danger");
  });

  it("accorde le singulier et le pluriel et mène à l’écran qui traite la tâche", () => {
    const [one] = buildTodayTasks({ ...empty, draftSaleCount: 1 });
    expect(one.title).toBe("1 vente à valider");
    expect(one.href).toBe("/ventes?status=draft");
    const [many] = buildTodayTasks({ ...empty, missingDocumentCount: 3 });
    expect(many.title).toBe("3 justificatifs manquants");
    const [declaration] = buildTodayTasks({ ...empty, pendingDeclarations: [{ periodStart: "2026-10-01", periodEnd: "2026-12-31", dueOn: "2027-01-31", status: "to-declare" }] });
    expect(declaration.href).toBe("/registres/declarations?annee=2026");
    expect(declaration.action).toBe("Préparer");
  });

  it("écrit la date du jour à l’heure de Paris", () => {
    expect(formatTodayLabel(new Date("2026-11-13T09:00:00Z"))).toBe("Vendredi 13 novembre");
    expect(formatTodayLabel(new Date("2026-11-13T23:30:00Z"))).toBe("Samedi 14 novembre");
  });
});

describe("encaissements jour par jour", () => {
  const month = { key: "2026-11", start: "2026-11-01", end: "2026-12-01", label: "novembre 2026", referenceStart: "2026-08-03" };

  it("répartit les encaissements bruts sur chaque jour du mois", () => {
    const days = dailyCollectedCents([
      { receivedOn: "2026-11-01", grossAmountCents: 1_000, platformFeeCents: 0 },
      { receivedOn: "2026-11-01", grossAmountCents: 500, platformFeeCents: 0 },
      { receivedOn: "2026-11-30", grossAmountCents: 2_000, platformFeeCents: 0 },
      { receivedOn: "2026-12-01", grossAmountCents: 9_999, platformFeeCents: 0 },
      { grossAmountCents: 7, platformFeeCents: 0 },
    ], month);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe(1_500);
    expect(days[29]).toBe(2_000);
    expect(days.reduce((sum, value) => sum + value, 0)).toBe(3_500);
  });
});

describe("couverture des charges fixes", () => {
  const metrics = (monthlyCents: number | null, marginCents: number, reason: DashboardMetrics["fixedCostCoverage"]["unavailableReason"] = null) => ({
    fixedCosts: { eligibleTemplateCount: 1, monthlyCents, annualCents: null },
    profitability: { manufacturingMarginCents: marginCents },
    fixedCostCoverage: { deltaCents: null, unavailableReason: reason },
  }) as unknown as DashboardMetrics;

  it("donne la part couverte en pourcentage entier", () => {
    expect(fixedCostCoveragePercent(metrics(50_000, 39_000))).toBe(78);
    expect(fixedCostCoveragePercent(metrics(50_000, 75_000))).toBe(150);
  });

  it("reste indisponible sans charges fixes ou avec un coût incomplet", () => {
    expect(fixedCostCoveragePercent(metrics(null, 10_000, "fixed-costs-not-configured"))).toBeNull();
    expect(fixedCostCoveragePercent(metrics(50_000, 10_000, "incomplete-monthly-costing"))).toBeNull();
  });
});

describe("déclarations en attente", () => {
  it("retient les périodes échues sans déclaration, la plus ancienne d’abord", () => {
    const pending = pendingDeclarationPeriods("2025-01-01", "quarterly", [{ periodStart: "2025-01-01", periodEnd: "2025-06-30" }], "2026-11-13");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((period) => period.status === "overdue" || period.status === "to-declare")).toBe(true);
    expect(pending.some((period) => period.periodStart === "2025-01-01")).toBe(false);
    expect([...pending].sort((a, b) => a.dueOn.localeCompare(b.dueOn))).toEqual(pending);
  });

  it("ne propose rien sans date de début d’activité", () => {
    expect(pendingDeclarationPeriods(null, "quarterly", [], "2026-11-13")).toEqual([]);
  });
});
