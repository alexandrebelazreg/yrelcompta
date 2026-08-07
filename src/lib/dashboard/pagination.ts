export const DASHBOARD_PAGE_SIZE = 1000;

export interface DashboardPageResult<T> {
  data: T[] | null;
  error: { code?: string } | null;
}

export async function loadAllDashboardPages<T>(
  loadPage: (from: number, to: number) => Promise<DashboardPageResult<T>>,
  onError: (code: string | undefined) => void,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DASHBOARD_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + DASHBOARD_PAGE_SIZE - 1);
    if (error) {
      onError(error.code);
      throw new Error("DASHBOARD_DATA_LOAD_FAILED");
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < DASHBOARD_PAGE_SIZE) return rows;
  }
}
