import type { BillingCommercialState, BillingCustomerKind, BillingDocumentKind, BillingOperationCategory } from "@/types/invoicing";

export const billingDocumentKindLabels: Record<BillingDocumentKind, string> = { invoice: "Facture", credit_note: "Avoir" };
export const billingCustomerKindLabels: Record<BillingCustomerKind, string> = { individual: "Particulier", professional: "Professionnel" };
export const billingOperationCategoryLabels: Record<BillingOperationCategory, string> = { goods: "Vente de biens", services: "Prestations de services", mixed: "Biens et services" };
export const billingCommercialStateLabels: Record<BillingCommercialState, string> = {
  invoice: "Facture",
  "partially-credited": "Partiellement créditée",
  "fully-credited": "Créditée intégralement",
  "credit-note": "Avoir",
};
