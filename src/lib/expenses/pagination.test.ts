import { describe, expect, it, vi } from "vitest";
import { loadAllExpensePages } from "./pagination";

describe("pagination financière exhaustive", () => {
  it("échoue dès la première page sans restituer de total", async () => {
    const onError = vi.fn();
    const result = loadAllExpensePages<{ business_amount_cents: number }>(
      async () => ({ data: null, error: { code: "FIRST_PAGE" } }),
      "EXPENSE_DASHBOARD_AGGREGATION_FAILED",
      onError,
    );
    await expect(result).rejects.toThrow("EXPENSE_DASHBOARD_AGGREGATION_FAILED");
    expect(onError).toHaveBeenCalledWith("FIRST_PAGE");
  });

  it("rejette tout le résultat si une page ultérieure échoue", async () => {
    const firstPage = Array.from({ length: 1000 }, () => ({ business_amount_cents: 9 }));
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "SECOND_PAGE" } });
    const result = loadAllExpensePages<{ business_amount_cents: number }>(
      loadPage,
      "EXPENSE_DASHBOARD_AGGREGATION_FAILED",
      vi.fn(),
    );
    await expect(result).rejects.toThrow("EXPENSE_DASHBOARD_AGGREGATION_FAILED");
    await expect(result.then((rows) => rows.reduce((sum, row) => sum + row.business_amount_cents, 0))).rejects.toThrow(
      "EXPENSE_DASHBOARD_AGGREGATION_FAILED",
    );
  });
});
