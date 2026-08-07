import { describe, expect, it, vi } from "vitest";
import { BILLING_PAGE_SIZE, loadAllBillingPages } from "./pagination";

describe("pagination des factures", () => {
  it("charge exactement 1000 puis une page vide", async () => { const load = vi.fn(async (from: number) => ({ data: from === 0 ? Array.from({ length: 1000 }, (_, id) => id) : [], error: null })); expect(await loadAllBillingPages(load, vi.fn())).toHaveLength(1000); expect(load).toHaveBeenCalledTimes(2); });
  it("charge 1001 lignes", async () => { const load = vi.fn(async (from: number) => ({ data: from === 0 ? Array(1000).fill(1) : [1], error: null })); expect(await loadAllBillingPages(load, vi.fn())).toHaveLength(1001); });
  it("charge plusieurs pages", async () => { const load = vi.fn(async (from: number) => ({ data: from < 3000 ? Array(BILLING_PAGE_SIZE).fill(1) : [], error: null })); expect(await loadAllBillingPages(load, vi.fn())).toHaveLength(3000); });
  it("ne retourne aucune donnée partielle après une erreur", async () => { const log = vi.fn(); const load = vi.fn(async (from: number) => from === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: { code: "PGRST500" } }); await expect(loadAllBillingPages(load, log)).rejects.toThrow("BILLING_DATA_LOAD_FAILED"); expect(log).toHaveBeenCalledWith("PGRST500"); });
});
