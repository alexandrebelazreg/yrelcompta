export const BILLING_PAGE_SIZE = 1000;

export async function loadAllBillingPages<T>(
  loader: (from: number, to: number) => Promise<{ data: T[] | null; error: { code?: string } | null }>,
  logError: (code: string | undefined) => void,
): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += BILLING_PAGE_SIZE) {
    const page = await loader(from, from + BILLING_PAGE_SIZE - 1);
    if (page.error) {
      logError(page.error.code);
      throw new Error("BILLING_DATA_LOAD_FAILED");
    }
    const rows = page.data ?? [];
    result.push(...rows);
    if (rows.length < BILLING_PAGE_SIZE) return result;
  }
}
