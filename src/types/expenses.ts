export type ExpenseStatus = "draft" | "validated" | "cancelled";
export type ExpenseCategory = "raw_materials" | "packaging" | "shipping" | "marketplace_fees" | "software" | "marketing" | "market_fees" | "equipment" | "insurance" | "bank_fees" | "telecommunications" | "professional_services" | "taxes_social" | "travel" | "office" | "training" | "other";
export type ExpenseNature = "operating" | "investment" | "tax_social";
export type ExpenseCostBehavior = "fixed" | "variable" | "exceptional";
export type ExpensePaymentMethod = "cash" | "card" | "bank_transfer" | "paypal" | "cheque" | "direct_debit" | "other";
export type ExpenseRefundKind = "supplier_refund" | "credit_note" | "correction";
export type DocumentKind = "supplier_invoice" | "receipt" | "bank_proof" | "credit_note" | "contract" | "other";
export type RecurrenceFrequency = "monthly" | "quarterly" | "yearly";

export interface Supplier { id: string; business_id: string; name: string; email: string | null; phone: string | null; website: string | null; notes: string | null; is_active: boolean; }
export interface ExpenseRefund { id: string; expense_payment_id: string; received_on: string; amount_cents: number; business_amount_cents: number; kind: ExpenseRefundKind; reason: string; external_reference: string | null; }
export interface ExpensePayment { id: string; paid_on: string; bank_debited_on: string | null; amount_cents: number; business_amount_cents: number; method: ExpensePaymentMethod; external_reference: string | null; notes: string | null; expense_refunds: ExpenseRefund[]; }
export interface ExpenseDocument { id: string; kind: DocumentKind; storage_path: string; original_name: string; mime_type: string; size_bytes: number; created_at: string; }
export interface ExpenseDocumentLink { id: string; document_id: string; documents: ExpenseDocument | null; }
export interface Expense {
  id: string; business_id: string; reference: string; purchased_on: string; due_on: string | null; supplier_id: string | null;
  category: ExpenseCategory; subcategory: string | null; nature: ExpenseNature; cost_behavior: ExpenseCostBehavior;
  description: string; external_reference: string | null; total_amount_cents: number; professional_share_basis_points: number;
  business_amount_cents: number; notes: string | null; status: ExpenseStatus; validated_at: string | null;
  cancelled_at: string | null; cancellation_reason: string | null; suppliers: Pick<Supplier,"id"|"name"> | null;
  expense_payments: ExpensePayment[]; expense_documents: ExpenseDocumentLink[];
}
export interface RecurringExpenseTemplate { id: string; business_id: string; supplier_id: string | null; category: ExpenseCategory; subcategory: string | null; nature: ExpenseNature; cost_behavior: ExpenseCostBehavior; description: string; estimated_amount_cents: number; professional_share_basis_points: number; frequency: RecurrenceFrequency; next_due_on: string; last_generated_on: string | null; notes: string | null; is_active: boolean; suppliers: Pick<Supplier,"id"|"name"> | null; }
export interface ExpenseFinancialSummary { totalCents: number; businessCents: number; grossPaidCents: number; businessPaidCents: number; grossRefundedCents: number; businessRefundedCents: number; netCashCents: number; netBusinessCents: number; remainingCents: number; }
export interface ExpenseTotals extends ExpenseFinancialSummary { validatedExpensesCents: number; missingDocuments: number; }
