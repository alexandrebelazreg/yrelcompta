import type { ExpenseCategory, ExpenseCostBehavior, ExpenseNature, RecurrenceFrequency } from "@/types/expenses";
import type { SaleChannel, SaleStatus } from "@/types/sales";

export interface DashboardMonth {
  key: string;
  start: string;
  end: string;
  label: string;
  referenceStart: string;
}

export interface DashboardPayment {
  grossAmountCents: number;
  platformFeeCents: number;
}

export interface DashboardRefund {
  amountCents: number;
}

export interface DashboardExpenseFlow {
  businessAmountCents: number;
}

export interface DashboardSaleCosting {
  status: SaleStatus;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  manufacturingCostCents: number | null;
  manufacturingMarginCents: number | null;
  costingComplete: boolean;
  costingEvaluated: boolean;
}

export interface DashboardRecurringTemplate {
  category: ExpenseCategory;
  nature: ExpenseNature;
  costBehavior: ExpenseCostBehavior;
  estimatedAmountCents: number;
  professionalShareBasisPoints: number;
  frequency: RecurrenceFrequency;
  isActive: boolean;
}

export interface DashboardMissingDocument {
  documentCount: number;
}

export interface DashboardRecentSale {
  id: string;
  reference: string;
  orderedOn: string;
  channel: SaleChannel;
  totalCents: number;
}

export interface DashboardSourceData {
  payments: DashboardPayment[];
  customerRefunds: DashboardRefund[];
  expensePayments: DashboardExpenseFlow[];
  expenseRefunds: DashboardExpenseFlow[];
  monthlySales: DashboardSaleCosting[];
  referenceSales: DashboardSaleCosting[];
  recurringTemplates: DashboardRecurringTemplate[];
  missingDocuments: DashboardMissingDocument[];
  recentSales: DashboardRecentSale[];
}

export type BreakEvenUnavailableReason =
  | "fixed-costs-not-configured"
  | "no-reference-sales"
  | "non-positive-reference-revenue"
  | "non-positive-reference-margin";

export interface DashboardMetrics {
  cash: {
    grossCollectedCents: number;
    customerRefundedCents: number;
    revenueCollectedCents: number;
    platformFeesCents: number;
    expensesPaidCents: number;
    expenseRefundedCents: number;
    netExpensesCents: number;
    trackedCashCents: number;
  };
  profitability: {
    saleCount: number;
    completeCount: number;
    incompleteCount: number;
    historicalCount: number;
    completeMerchandiseRevenueCents: number;
    manufacturingCostCents: number;
    manufacturingMarginCents: number;
    marginRateBasisPoints: number | null;
  };
  fixedCosts: {
    eligibleTemplateCount: number;
    monthlyCents: number | null;
    annualCents: number | null;
  };
  reference: {
    saleCount: number;
    merchandiseRevenueCents: number;
    manufacturingMarginCents: number;
    marginRateBasisPoints: number | null;
  };
  breakEven: {
    monthlyRevenueCents: number | null;
    unavailableReason: BreakEvenUnavailableReason | null;
  };
  fixedCostCoverageDeltaCents: number | null;
  missingDocumentCount: number;
}
