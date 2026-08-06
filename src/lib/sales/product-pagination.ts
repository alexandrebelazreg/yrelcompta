export interface SaleProductPageResult<T> {
  data: T[] | null;
  error: { code?: string } | null;
}

export async function loadAllSaleProductPages<T>(
  loadPage: (from: number, to: number) => Promise<SaleProductPageResult<T>>,
  onError: (code: string | undefined) => void,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) {
      onError(error.code);
      throw new Error("SALE_PRODUCT_CATALOG_LOAD_FAILED");
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
