import type { DeclarationPeriod, VatRegime } from "@/types/database";
import type { ExpensePaymentMethod, ExpenseRefundKind } from "@/types/expenses";
import type { PaymentMethod, RefundKind, SaleChannel } from "@/types/sales";

export type DeclarationCalculationStatus = "available" | "vat-unmodeled" | "refund-review-required";
export type DeclarationUiStatus = "upcoming" | "to-declare" | "overdue" | "declared";

export interface RevenueRegisterEntry {
  id: string;
  receivedOn: string;
  origin: string;
  saleReference: string;
  channel: SaleChannel;
  method: PaymentMethod;
  paymentReference: string | null;
  grossAmountCents: number;
  platformFeeCents: number;
  createdAt: string;
}

export interface CustomerRefundRegisterEntry {
  id: string;
  refundedOn: string;
  saleReference: string;
  paymentReference: string | null;
  amountCents: number;
  kind: RefundKind;
  reason: string;
  createdAt: string;
}

export interface PurchaseRegisterEntry {
  id: string;
  paidOn: string;
  expenseReference: string;
  description: string;
  method: ExpensePaymentMethod;
  supplierReference: string | null;
  paymentReference: string | null;
  amountCents: number;
  businessAmountCents: number;
  createdAt: string;
}

export interface SupplierRefundRegisterEntry {
  id: string;
  receivedOn: string;
  expenseReference: string;
  amountCents: number;
  kind: ExpenseRefundKind;
  reason: string;
  externalReference: string | null;
  createdAt: string;
}

export interface RegisterTotals {
  quarterCents: [number, number, number, number];
  annualCents: number;
}

export interface TurnoverDeclaration {
  id: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  declarationPeriodSnapshot: DeclarationPeriod;
  vatRegimeSnapshot: VatRegime;
  revisionNo: number;
  previousDeclarationId: string | null;
  calculationStatus: DeclarationCalculationStatus;
  suggestedTurnoverCents: number | null;
  grossReceiptsSnapshotCents: number;
  customerRefundsSnapshotCents: number;
  paymentCountSnapshot: number;
  refundCountSnapshot: number;
  declaredTurnoverCents: number;
  submittedOn: string;
  externalReference: string | null;
  adjustmentReason: string | null;
  createdAt: string;
  fiscalEvaluated: boolean;
  fiscalProfileId: string | null;
  fiscalRuleVersionId: string | null;
  acreRuleVersionId: string | null;
  socialRateBasisPointsSnapshot: number | null;
  cfpRateBasisPointsSnapshot: number | null;
  versementLiberatoireBasisPointsSnapshot: number | null;
  acreAppliedSnapshot: boolean | null;
  estimatedSocialContributionsCents: number | null;
  estimatedCfpCents: number | null;
  estimatedIncomeTaxCents: number | null;
  estimatedTotalReserveCents: number | null;
}

export interface DeclarationPeriodItem {
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  uiStatus: DeclarationUiStatus;
  grossReceiptsCents: number;
  customerRefundsCents: number;
  paymentCount: number;
  refundCount: number;
  calculationStatus: DeclarationCalculationStatus;
  suggestedTurnoverCents: number | null;
  latestDeclaration: TurnoverDeclaration | null;
  revisions: TurnoverDeclaration[];
}

export interface DeclarationSettings {
  activityStartedOn: string | null;
  declarationPeriod: DeclarationPeriod;
  vatRegime: VatRegime;
}

export interface DeclarationsPageData {
  settings: DeclarationSettings;
  periods: DeclarationPeriodItem[];
  annualGrossReceiptsCents: number;
  annualCustomerRefundsCents: number;
  annualDeclaredCents: number;
}
