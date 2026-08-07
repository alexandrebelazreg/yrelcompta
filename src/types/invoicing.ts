import type { VatRegime } from "./database";

export type BillingDocumentKind = "invoice" | "credit_note";
export type BillingCustomerKind = "individual" | "professional";
export type BillingOperationCategory = "goods" | "services" | "mixed";
export type BillingCommercialState = "invoice" | "partially-credited" | "fully-credited" | "credit-note";

export interface InvoiceSettings {
  businessId: string;
  issuerLegalName: string;
  issuerTradeName: string | null;
  issuerSiret: string;
  issuerAddress: string;
  issuerEmail: string | null;
  issuerPhone: string | null;
  issuerRegistrationDetails: string | null;
  vatExemptionMention: string;
  defaultPaymentTerms: string | null;
  defaultEarlyPaymentDiscountTerms: string | null;
  defaultLatePenaltyTerms: string | null;
  defaultRecoveryIndemnityText: string | null;
}

export interface BillingDocumentItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceExclTaxCents: number;
  lineTotalExclTaxCents: number;
  position: number;
}

export interface BillingDocument {
  id: string;
  businessId: string;
  saleId: string;
  saleReference: string;
  kind: BillingDocumentKind;
  number: string;
  issuedOn: string;
  supplyOn: string;
  originalInvoiceId: string | null;
  originalInvoiceNumber: string | null;
  originalInvoiceIssuedOn: string | null;
  linkedRefundId: string | null;
  operationCategory: BillingOperationCategory;
  buyerKind: BillingCustomerKind;
  buyerName: string;
  buyerAddress: string | null;
  buyerAddressOmitted: boolean;
  buyerBillingAddress: string | null;
  buyerDeliveryAddress: string | null;
  buyerEmail: string | null;
  buyerSiren: string | null;
  buyerVatNumber: string | null;
  purchaseOrderReference: string | null;
  issuerLegalNameSnapshot: string;
  issuerTradeNameSnapshot: string | null;
  issuerSiretSnapshot: string;
  issuerSirenSnapshot: string;
  issuerAddressSnapshot: string;
  issuerEmailSnapshot: string | null;
  issuerPhoneSnapshot: string | null;
  issuerRegistrationDetailsSnapshot: string | null;
  vatRegimeSnapshot: VatRegime;
  vatExemptionMentionSnapshot: string;
  subtotalExclTaxCents: number;
  shippingExclTaxCents: number;
  discountExclTaxCents: number;
  totalExclTaxCents: number;
  vatCents: number;
  totalInclTaxCents: number;
  paymentDueOn: string;
  paymentTermsSnapshot: string | null;
  earlyPaymentDiscountTermsSnapshot: string | null;
  latePenaltyTermsSnapshot: string | null;
  recoveryIndemnitySnapshot: string | null;
  creditReason: string | null;
  renderVersion: number;
  createdAt: string;
  items: BillingDocumentItem[];
  credits: BillingDocument[];
  commercialState: BillingCommercialState;
}

export interface BillingRefundOption {
  id: string;
  refundedOn: string;
  amountCents: number;
  reason: string;
  linked: boolean;
}
