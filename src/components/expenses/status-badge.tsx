import { expenseStatusLabels } from "@/lib/expenses/labels";import type { ExpenseStatus } from "@/types/expenses";
export function ExpenseStatusBadge({status}:{status:ExpenseStatus}){return <span className={`sale-status sale-status-${status}`}>{expenseStatusLabels[status]}</span>}
