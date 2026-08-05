import type { PaymentMethod, RefundKind, SaleChannel, SaleStatus } from "@/types/sales";

export const saleChannelLabels: Record<SaleChannel, string> = {
  direct: "Vente directe", market: "Marché ou salon", instagram: "Instagram", etsy: "Etsy",
  website: "Site internet", shopify: "Shopify", retailer: "Boutique partenaire", other: "Autre",
};
export const saleStatusLabels: Record<SaleStatus, string> = { draft: "Brouillon", validated: "Validée", cancelled: "Annulée" };
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Espèces", card: "Carte bancaire", bank_transfer: "Virement", paypal: "PayPal",
  stripe: "Stripe", sumup: "SumUp", etsy: "Etsy", cheque: "Chèque", other: "Autre",
};
export const refundKindLabels: Record<RefundKind, string> = { customer_refund: "Remboursement cliente", correction: "Correction" };
