import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_PAGE_SIZE, loadAllDashboardPages } from "./pagination";

describe("pagination exhaustive du tableau de bord", () => {
  it("charge toutes les pages au-delà de la limite Supabase de 1 000 lignes", async () => {
    const first = Array.from({ length: DASHBOARD_PAGE_SIZE }, (_, id) => ({ id }));
    const second = Array.from({ length: 5 }, (_, id) => ({ id: id + DASHBOARD_PAGE_SIZE }));
    const loadPage = vi.fn().mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: second, error: null });
    const rows = await loadAllDashboardPages(loadPage, vi.fn());
    expect(rows).toHaveLength(1_005);
    expect(loadPage).toHaveBeenNthCalledWith(1, 0, 999);
    expect(loadPage).toHaveBeenNthCalledWith(2, 1_000, 1_999);
  });

  it("rejette tout résultat si la première page échoue", async () => {
    const onError = vi.fn();
    await expect(loadAllDashboardPages(async () => ({ data: null, error: { code: "FIRST_PAGE" } }), onError))
      .rejects.toThrow("DASHBOARD_DATA_LOAD_FAILED");
    expect(onError).toHaveBeenCalledWith("FIRST_PAGE");
  });

  it("ne restitue aucun total partiel si une page ultérieure échoue", async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1_000 }, () => ({ cents: 9 })), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "SECOND_PAGE" } });
    const result = loadAllDashboardPages<{ cents: number }>(loadPage, vi.fn());
    await expect(result).rejects.toThrow("DASHBOARD_DATA_LOAD_FAILED");
    await expect(result.then((rows) => rows.reduce((total, row) => total + row.cents, 0)))
      .rejects.toThrow("DASHBOARD_DATA_LOAD_FAILED");
  });
});
