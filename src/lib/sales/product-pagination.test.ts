import { describe, expect, it, vi } from "vitest";
import { loadAllSaleProductPages } from "./product-pagination";

describe("pagination du catalogue pour les ventes", () => {
  it("charge plus de 1 000 produits sans tronquer le catalogue", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null })
      .mockResolvedValueOnce({ data: Array.from({ length: 7 }, (_, id) => ({ id: id + 1000 })), error: null });
    expect(await loadAllSaleProductPages(load, vi.fn())).toHaveLength(1007);
    expect(load).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("rejette tout le chargement si une page échoue", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ id: "ok" })), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "PAGE_FAILED" } });
    await expect(loadAllSaleProductPages(load, vi.fn())).rejects.toThrow("SALE_PRODUCT_CATALOG_LOAD_FAILED");
  });
});
