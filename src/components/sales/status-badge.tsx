import { saleStatusLabels } from "@/lib/sales/labels";
import type { SaleStatus } from "@/types/sales";

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return <span className={`sale-status sale-status-${status}`}>{saleStatusLabels[status]}</span>;
}
