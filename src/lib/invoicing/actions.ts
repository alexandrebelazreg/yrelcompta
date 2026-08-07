"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { parseFrenchMoneyToCents } from "@/lib/sales/calculations";
import { createClient } from "@/lib/supabase/server";

const nullableText = (max: number) => z.string().trim().max(max);
const settingsSchema = z.object({
  issuerLegalName: z.string().trim().min(2).max(200), issuerTradeName: nullableText(200),
  issuerSiret: z.string().regex(/^\d{14}$/), issuerAddress: z.string().trim().min(5).max(1000),
  issuerEmail: nullableText(254), issuerPhone: nullableText(50), issuerRegistrationDetails: nullableText(500),
  vatExemptionMention: z.string().trim().min(2).max(500), defaultPaymentTerms: nullableText(1000),
  defaultEarlyPaymentDiscountTerms: nullableText(1000), defaultLatePenaltyTerms: nullableText(1000),
  defaultRecoveryIndemnityText: nullableText(1000),
});
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const professionalBuyerSirenMessage = "Le SIREN à 9 chiffres est obligatoire pour un client professionnel dans la facturation V1.";
const invoiceSchema = z.object({
  saleId: z.string().uuid(), supplyOn: dateSchema, operationCategory: z.enum(["goods", "services", "mixed"]),
  buyerKind: z.enum(["individual", "professional"]), buyerName: z.string().trim().min(1).max(200),
  buyerAddress: nullableText(1000), buyerAddressOmitted: z.boolean(), buyerBillingAddress: nullableText(1000),
  buyerDeliveryAddress: nullableText(1000), buyerEmail: nullableText(254), buyerSiren: z.string().trim().refine((value) => value === "" || /^\d{9}$/.test(value)),
  buyerVatNumber: nullableText(50), purchaseOrderReference: nullableText(200), paymentDueOn: dateSchema,
}).superRefine((value, context) => {
  if (value.buyerKind === "professional" && !/^\d{9}$/.test(value.buyerSiren)) {
    context.addIssue({ code: "custom", path: ["buyerSiren"], message: professionalBuyerSirenMessage });
  }
});
const creditSchema = z.object({
  invoiceId: z.string().uuid(), amount: z.string().min(1).transform((value, context) => {
    try { return parseFrenchMoneyToCents(value); } catch { context.addIssue({ code: "custom", message: "Montant invalide" }); return z.NEVER; }
  }),
  reason: z.string().trim().min(2).max(500), linkedRefundId: z.string().trim().refine((value) => value === "" || z.uuid().safeParse(value).success),
});

async function mutationContext() {
  const [{ context }, supabase] = await Promise.all([getAuthenticatedContext(), createClient()]);
  return context.business && supabase ? { businessId: context.business.id, supabase } : null;
}

function billingError(message: string | undefined): string {
  const value = message ?? "";
  if (value.includes("VAT_INVOICING_NOT_SUPPORTED")) return "Facturation automatique indisponible : YrelCompta ne ventile pas encore la TVA. Aucune facture ne sera générée tant que cette ventilation n’est pas implémentée.";
  if (value.includes("PROFESSIONAL_BUYER_SIREN_REQUIRED")) return professionalBuyerSirenMessage;
  if (value.includes("invoice settings required")) return "Complétez d’abord les paramètres de facturation.";
  if (value.includes("professional invoice terms required")) return "Complétez les conditions B2B dans les paramètres de facturation.";
  if (value.includes("invoice already issued")) return "Une facture a déjà été émise pour cette vente.";
  if (value.includes("credit exceeds")) return "Le total des avoirs dépasserait le montant de la facture.";
  if (value.includes("refund")) return "Le remboursement sélectionné ne peut pas être lié à cet avoir.";
  return "L’opération de facturation a été refusée car les données sont incohérentes.";
}

export async function saveInvoiceSettingsAction(formData: FormData) {
  const parsed = settingsSchema.safeParse(Object.fromEntries([...settingsSchema.keyof().options].map((key) => [key, formData.get(key) ?? ""])));
  if (!parsed.success) redirect("/parametres/facturation?erreur=Vérifiez les paramètres de facturation");
  const context = await mutationContext();
  if (!context) redirect("/parametres/facturation?erreur=Session indisponible");
  const values = parsed.data;
  const { error } = await context.supabase.rpc("save_invoice_settings", {
    p_business_id: context.businessId, p_issuer_legal_name: values.issuerLegalName, p_issuer_trade_name: values.issuerTradeName || null,
    p_issuer_siret: values.issuerSiret, p_issuer_address: values.issuerAddress, p_issuer_email: values.issuerEmail || null,
    p_issuer_phone: values.issuerPhone || null, p_issuer_registration_details: values.issuerRegistrationDetails || null,
    p_vat_exemption_mention: values.vatExemptionMention, p_default_payment_terms: values.defaultPaymentTerms || null,
    p_default_early_payment_discount_terms: values.defaultEarlyPaymentDiscountTerms || null,
    p_default_late_penalty_terms: values.defaultLatePenaltyTerms || null,
    p_default_recovery_indemnity_text: values.defaultRecoveryIndemnityText || null,
  });
  if (error) { console.error("Paramètres de facturation refusés", { code: error.code }); redirect(`/parametres/facturation?erreur=${encodeURIComponent(billingError(error.message))}`); }
  revalidatePath("/parametres/facturation");
  redirect("/parametres/facturation?message=parametres-enregistres");
}

export async function issueInvoiceAction(formData: FormData) {
  const parsed = invoiceSchema.safeParse({
    saleId: formData.get("saleId"), supplyOn: formData.get("supplyOn"), operationCategory: formData.get("operationCategory"),
    buyerKind: formData.get("buyerKind"), buyerName: formData.get("buyerName"), buyerAddress: formData.get("buyerAddress") ?? "",
    buyerAddressOmitted: formData.get("buyerAddressOmitted") === "on", buyerBillingAddress: formData.get("buyerBillingAddress") ?? "",
    buyerDeliveryAddress: formData.get("buyerDeliveryAddress") ?? "", buyerEmail: formData.get("buyerEmail") ?? "",
    buyerSiren: formData.get("buyerSiren") ?? "", buyerVatNumber: formData.get("buyerVatNumber") ?? "",
    purchaseOrderReference: formData.get("purchaseOrderReference") ?? "", paymentDueOn: formData.get("paymentDueOn"),
  });
  const saleId = String(formData.get("saleId") ?? "");
  if (!parsed.success) {
    const message = parsed.error.issues.some((issue) => issue.path[0] === "buyerSiren" && issue.message === professionalBuyerSirenMessage)
      ? professionalBuyerSirenMessage
      : "Vérifiez les informations client et les dates";
    redirect(`/factures/nouvelle?vente=${encodeURIComponent(saleId)}&erreur=${encodeURIComponent(message)}`);
  }
  const context = await mutationContext();
  if (!context) redirect("/factures?erreur=Session indisponible");
  const value = parsed.data;
  const { data, error } = await context.supabase.rpc("issue_invoice", {
    p_business_id: context.businessId, p_sale_id: value.saleId, p_supply_on: value.supplyOn,
    p_operation_category: value.operationCategory, p_buyer_kind: value.buyerKind, p_buyer_name: value.buyerName,
    p_buyer_address: value.buyerAddress || null, p_buyer_address_omitted: value.buyerAddressOmitted,
    p_buyer_billing_address: value.buyerBillingAddress || null, p_buyer_delivery_address: value.buyerDeliveryAddress || null,
    p_buyer_email: value.buyerEmail || null, p_buyer_siren: value.buyerSiren || null, p_buyer_vat_number: value.buyerVatNumber || null,
    p_purchase_order_reference: value.purchaseOrderReference || null, p_payment_due_on: value.paymentDueOn,
  });
  if (error || !data) { console.error("Émission de facture refusée", { code: error?.code }); redirect(`/factures/nouvelle?vente=${value.saleId}&erreur=${encodeURIComponent(billingError(error?.message))}`); }
  revalidatePath("/factures"); revalidatePath(`/ventes/${value.saleId}`); revalidatePath("/documents");
  redirect(`/factures/${data}?message=facture-emise`);
}

export async function issueCreditNoteAction(formData: FormData) {
  const parsed = creditSchema.safeParse({ invoiceId: formData.get("invoiceId"), amount: formData.get("amount"), reason: formData.get("reason"), linkedRefundId: formData.get("linkedRefundId") ?? "" });
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!parsed.success) redirect(`/factures/${encodeURIComponent(invoiceId)}?erreur=Vérifiez le montant et le motif de l’avoir`);
  const context = await mutationContext();
  if (!context) redirect("/factures?erreur=Session indisponible");
  const { data, error } = await context.supabase.rpc("issue_credit_note", {
    p_business_id: context.businessId, p_original_invoice_id: parsed.data.invoiceId, p_amount_cents: parsed.data.amount,
    p_reason: parsed.data.reason, p_linked_refund_id: parsed.data.linkedRefundId || null,
  });
  if (error || !data) { console.error("Émission d’avoir refusée", { code: error?.code }); redirect(`/factures/${parsed.data.invoiceId}?erreur=${encodeURIComponent(billingError(error?.message))}`); }
  revalidatePath("/factures"); revalidatePath(`/factures/${parsed.data.invoiceId}`); revalidatePath("/documents");
  redirect(`/factures/${data}?message=avoir-emis`);
}
