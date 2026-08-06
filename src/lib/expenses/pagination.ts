export interface ExpensePageResult<T> {
  data: T[] | null;
  error: { code?: string } | null;
}

export async function loadAllExpensePages<T>(
  loadPage: (from: number, to: number) => Promise<ExpensePageResult<T>>,
  failureCode: string,
  onError: (code: string | undefined) => void,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) {
      onError(error.code);
      throw new Error(failureCode);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function sumExpenseAmounts<T>(rows:T[],amount:(row:T)=>number):number {
  let total=BigInt(0);
  for(const row of rows){const value=amount(row);if(!Number.isSafeInteger(value))throw new Error("EXPENSE_AGGREGATION_UNSAFE_INTEGER");total+=BigInt(value);}
  const result=Number(total);
  if(!Number.isSafeInteger(result))throw new Error("EXPENSE_AGGREGATION_UNSAFE_INTEGER");
  return result;
}
