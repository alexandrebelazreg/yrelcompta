import { describe, expect, it, vi } from "vitest";
import { loadAllRegisterPages } from "./pagination";

describe("pagination exhaustive des registres", () => {
  it("s’arrête après une page de exactement 1 000 suivie d’une page vide", async () => {
    const load = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1_000 }, (_, id) => ({ id })), error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await loadAllRegisterPages(load, vi.fn())).toHaveLength(1_000);
    expect(load).toHaveBeenLastCalledWith(1_000, 1_999);
  });

  it("charge 1 001 lignes sur deux pages", async () => {
    const load = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1_000 }, (_, id) => ({ id })), error: null }).mockResolvedValueOnce({ data: [{ id: 1_000 }], error: null });
    expect(await loadAllRegisterPages(load, vi.fn())).toHaveLength(1_001);
  });

  it("charge plusieurs pages complètes", async () => {
    const page = Array.from({ length: 1_000 }, (_, id) => ({ id }));
    const load = vi.fn().mockResolvedValueOnce({ data: page, error: null }).mockResolvedValueOnce({ data: page, error: null }).mockResolvedValueOnce({ data: [{ id: 2_000 }], error: null });
    expect(await loadAllRegisterPages(load, vi.fn())).toHaveLength(2_001);
  });

  it("rejette toute donnée partielle si la deuxième page échoue", async () => {
    const onError = vi.fn();
    const load = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1_000 }, () => ({ cents: 9 })), error: null }).mockResolvedValueOnce({ data: null, error: { code: "SECOND_PAGE" } });
    const result = loadAllRegisterPages<{ cents: number }>(load, onError);
    await expect(result).rejects.toThrow("REGISTER_DATA_LOAD_FAILED");
    await expect(result.then((rows) => rows.reduce((sum, row) => sum + row.cents, 0))).rejects.toThrow("REGISTER_DATA_LOAD_FAILED");
    expect(onError).toHaveBeenCalledWith("SECOND_PAGE");
  });
});
