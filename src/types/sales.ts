export type SaleStatus = "draft" | "validated" | "cancelled";
export type SaleChannel = "direct" | "market" | "instagram" | "etsy" | "website" | "shopify" | "retailer" | "other";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "paypal" | "stripe" | "sumup" | "etsy" | "cheque" | "other";
export type RefundKind = "customer_refund" | "correction";

export interface SaleItem {
  id?: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  product_id: string | null;
  product_name_snapshot: string | null;
  product_sku_snapshot: string | null;
  unit_raw_materials_cost_cents: number | null;
  unit_material_loss_cost_cents: number | null;
  unit_labor_cost_cents: number | null;
  unit_packaging_cost_cents: number | null;
  unit_manufacturing_cost_cents: number | null;
  line_manufacturing_cost_cents: number | null;
  line_margin_before_discount_cents: number | null;
  position: number;
  product: { name: string; sku: string | null; is_active: boolean } | null;
}

export interface SaleProductOption {
  id: string;
  name: string;
  sku: string | null;
  sale_price_cents: number;
  is_active: boolean;
}

export interface Refund {
  id: string;
  payment_id: string;
  refunded_on: string;
  amount_cents: number;
  kind: RefundKind;
  reason: string;
}

export interface Payment {
  id: string;
  received_on: string;
  bank_deposited_on: string | null;
  gross_amount_cents: number;
  platform_fee_cents: number;
  net_deposit_cents: number;
  method: PaymentMethod;
  external_reference: string | null;
  notes: string | null;
  refunds: Refund[];
}

export interface Sale {
  id: string;
  business_id: string;
  reference: string;
  ordered_on: string;
  channel: SaleChannel;
  customer_name: string | null;
  notes: string | null;
  status: SaleStatus;
  subtotal_cents: number;
  shipping_cents: number;
  discount_cents: number;
  total_cents: number;
  manufacturing_cost_cents: number | null;
  manufacturing_margin_cents: number | null;
  costing_complete: boolean;
  costing_evaluated: boolean;
  validated_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  sale_items: SaleItem[];
  payments: Payment[];
}

export interface SaleFinancialSummary {
  totalCents: number;
  grossPaidCents: number;
  platformFeesCents: number;
  netDepositedCents: number;
  refundedCents: number;
  netCollectedCents: number;
  remainingCents: number;
}

export interface SalesTotals extends SaleFinancialSummary {
  validatedSalesCents: number;
}
