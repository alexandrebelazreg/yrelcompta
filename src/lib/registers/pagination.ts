export const REGISTER_PAGE_SIZE = 1000;

export interface RegisterPageResult<T> {
  data: T[] | null;
  error: { code?: string } | null;
}

export async function loadAllRegisterPages<T>(
  loadPage: (from: number, to: number) => Promise<RegisterPageResult<T>>,
  onError: (code: string | undefined) => void,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += REGISTER_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + REGISTER_PAGE_SIZE - 1);
    if (error) {
      onError(error.code);
      throw new Error("REGISTER_DATA_LOAD_FAILED");
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < REGISTER_PAGE_SIZE) return rows;
  }
}
