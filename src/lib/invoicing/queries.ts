import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSale } from "@/lib/sales/queries";
import type { VatRegime } from "@/types/database";
import type {
  BillingDocument,
  BillingDocumentItem,
  BillingDocumentKind,
  BillingRefundOption,
  InvoiceSettings,
} from "@/types/invoicing";
import { billingCommercialState, sumInvoiceCents } from "./calculations";
import { loadAllBillingPages } from "./pagination";

const FAILURE = "BILLING_DATA_LOAD_FAILED";

function logError(code: string | undefined) {
  console.error("Lecture de la facturation impossible", { code });
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function item(row: Record<string, unknown>): BillingDocumentItem {
  return {
    id: String(row.id),
    description: String(row.description),
    quantity: Number(row.quantity),
    unitPriceExclTaxCents: sumInvoiceCents([row.unit_price_excl_tax_cents as string | number]),
    lineTotalExclTaxCents: sumInvoiceCents([row.line_total_excl_tax_cents as string | number]),
    position: Number(row.position),
  };
}

function document(row: Record<string, unknown>, items: BillingDocumentItem[] = [], original: Record<string, unknown> | null = null): BillingDocument {
  const kind = row.kind as BillingDocumentKind;
  const credits: BillingDocument[] = [];
  const totalInclTaxCents = sumInvoiceCents([row.total_incl_tax_cents as string | number]);
  return {
    id: String(row.id), businessId: String(row.business_id), saleId: String(row.sale_id),
    saleReference: String(relation(row.sales)?.reference ?? ""), kind, number: String(row.number),
    issuedOn: String(row.issued_on), supplyOn: String(row.supply_on),
    originalInvoiceId: textOrNull(row.original_invoice_id), originalInvoiceNumber: original ? String(original.number) : null,
    originalInvoiceIssuedOn: original ? String(original.issued_on) : null, linkedRefundId: textOrNull(row.linked_refund_id),
    operationCategory: row.operation_category as BillingDocument["operationCategory"], buyerKind: row.buyer_kind as BillingDocument["buyerKind"],
    buyerName: String(row.buyer_name), buyerAddress: textOrNull(row.buyer_address), buyerAddressOmitted: Boolean(row.buyer_address_omitted),
    buyerBillingAddress: textOrNull(row.buyer_billing_address), buyerDeliveryAddress: textOrNull(row.buyer_delivery_address),
    buyerEmail: textOrNull(row.buyer_email), buyerSiren: textOrNull(row.buyer_siren), buyerVatNumber: textOrNull(row.buyer_vat_number),
    purchaseOrderReference: textOrNull(row.purchase_order_reference), issuerLegalNameSnapshot: String(row.issuer_legal_name_snapshot),
    issuerTradeNameSnapshot: textOrNull(row.issuer_trade_name_snapshot), issuerSiretSnapshot: String(row.issuer_siret_snapshot),
    issuerSirenSnapshot: String(row.issuer_siren_snapshot), issuerAddressSnapshot: String(row.issuer_address_snapshot),
    issuerEmailSnapshot: textOrNull(row.issuer_email_snapshot), issuerPhoneSnapshot: textOrNull(row.issuer_phone_snapshot),
    issuerRegistrationDetailsSnapshot: textOrNull(row.issuer_registration_details_snapshot), vatRegimeSnapshot: row.vat_regime_snapshot as VatRegime,
    vatExemptionMentionSnapshot: String(row.vat_exemption_mention_snapshot),
    subtotalExclTaxCents: sumInvoiceCents([row.subtotal_excl_tax_cents as string | number]),
    shippingExclTaxCents: sumInvoiceCents([row.shipping_excl_tax_cents as string | number]),
    discountExclTaxCents: sumInvoiceCents([row.discount_excl_tax_cents as string | number]),
    totalExclTaxCents: sumInvoiceCents([row.total_excl_tax_cents as string | number]), vatCents: sumInvoiceCents([row.vat_cents as string | number]),
    totalInclTaxCents, paymentDueOn: String(row.payment_due_on),
    paymentTermsSnapshot: textOrNull(row.payment_terms_snapshot), earlyPaymentDiscountTermsSnapshot: textOrNull(row.early_payment_discount_terms_snapshot),
    latePenaltyTermsSnapshot: textOrNull(row.late_penalty_terms_snapshot), recoveryIndemnitySnapshot: textOrNull(row.recovery_indemnity_snapshot),
    creditReason: textOrNull(row.credit_reason), renderVersion: Number(row.render_version), createdAt: String(row.created_at),
    items: items.sort((a, b) => a.position - b.position), credits,
    commercialState: billingCommercialState(kind, totalInclTaxCents, 0),
  };
}

export async function getInvoiceSettings(businessId: string): Promise<InvoiceSettings | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("invoice_settings").select("*").eq("business_id", businessId).maybeSingle();
  if (error) { logError(error.code); throw new Error(FAILURE); }
  if (!data) return null;
  return {
    businessId: String(data.business_id), issuerLegalName: String(data.issuer_legal_name), issuerTradeName: textOrNull(data.issuer_trade_name),
    issuerSiret: String(data.issuer_siret), issuerAddress: String(data.issuer_address), issuerEmail: textOrNull(data.issuer_email),
    issuerPhone: textOrNull(data.issuer_phone), issuerRegistrationDetails: textOrNull(data.issuer_registration_details),
    vatExemptionMention: String(data.vat_exemption_mention), defaultPaymentTerms: textOrNull(data.default_payment_terms),
    defaultEarlyPaymentDiscountTerms: textOrNull(data.default_early_payment_discount_terms), defaultLatePenaltyTerms: textOrNull(data.default_late_penalty_terms),
    defaultRecoveryIndemnityText: textOrNull(data.default_recovery_indemnity_text),
  };
}

async function allDocumentRows(businessId: string): Promise<Array<Record<string, unknown>>> {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE);
  return loadAllBillingPages(async (from, to) => {
    const { data, error } = await supabase.from("billing_documents").select("*,sales!billing_documents_sale_business_fk(reference)")
      .eq("business_id", businessId).order("issued_on", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    return { data: data as unknown as Array<Record<string, unknown>> | null, error };
  }, logError);
}

export async function listBillingDocuments(businessId: string, filters: { year?: number; kind?: BillingDocumentKind; search?: string } = {}): Promise<BillingDocument[]> {
  const rows = await allDocumentRows(businessId);
  const creditsByInvoice = new Map<string, number[]>();
  for (const row of rows) if (row.kind === "credit_note" && row.original_invoice_id) {
    const values = creditsByInvoice.get(String(row.original_invoice_id)) ?? [];
    values.push(sumInvoiceCents([row.total_incl_tax_cents as string | number]));
    creditsByInvoice.set(String(row.original_invoice_id), values);
  }
  const search = filters.search?.trim().toLocaleLowerCase("fr-FR") ?? "";
  return rows.filter((row) => {
    if (filters.year && !String(row.issued_on).startsWith(`${filters.year}-`)) return false;
    if (filters.kind && row.kind !== filters.kind) return false;
    return !search || `${row.number} ${row.buyer_name} ${relation(row.sales)?.reference ?? ""}`.toLocaleLowerCase("fr-FR").includes(search);
  }).map((row) => {
    const result = document(row);
    const credited = sumInvoiceCents(creditsByInvoice.get(result.id) ?? []);
    result.commercialState = billingCommercialState(result.kind, result.totalInclTaxCents, credited);
    return result;
  });
}

export async function getBillingDocument(businessId: string, documentId: string): Promise<{ document: BillingDocument; refunds: BillingRefundOption[] } | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: row, error } = await supabase.from("billing_documents").select("*,sales!billing_documents_sale_business_fk(reference)")
    .eq("business_id", businessId).eq("id", documentId).maybeSingle();
  if (error) { logError(error.code); throw new Error(FAILURE); }
  if (!row) return null;
  const [itemsResult, creditsResult, refundsResult, originalResult] = await Promise.all([
    supabase.from("billing_document_items").select("*").eq("business_id", businessId).eq("billing_document_id", documentId).order("position"),
    supabase.from("billing_documents").select("*,sales!billing_documents_sale_business_fk(reference)").eq("business_id", businessId).eq("original_invoice_id", documentId).order("issued_on").order("id"),
    supabase.from("refunds").select("id,refunded_on,amount_cents,reason,billing_documents!billing_documents_refund_business_sale_fk(id)").eq("business_id", businessId).eq("sale_id", row.sale_id).order("refunded_on").order("id"),
    row.original_invoice_id ? supabase.from("billing_documents").select("number,issued_on").eq("business_id", businessId).eq("id", row.original_invoice_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [itemsResult, creditsResult, refundsResult, originalResult]) if (result.error) { logError(result.error.code); throw new Error(FAILURE); }
  const result = document(row as unknown as Record<string, unknown>, (itemsResult.data ?? []).map((value) => item(value as unknown as Record<string, unknown>)), originalResult.data as unknown as Record<string, unknown> | null);
  result.credits = (creditsResult.data ?? []).map((value) => document(value as unknown as Record<string, unknown>));
  result.commercialState = billingCommercialState(result.kind, result.totalInclTaxCents, sumInvoiceCents(result.credits.map((credit) => credit.totalInclTaxCents)));
  return {
    document: result,
    refunds: (refundsResult.data ?? []).map((value) => ({
      id: String(value.id), refundedOn: String(value.refunded_on), amountCents: sumInvoiceCents([value.amount_cents]),
      reason: String(value.reason), linked: Array.isArray(value.billing_documents) && value.billing_documents.length > 0,
    })),
  };
}

export async function getInvoiceForSale(businessId: string, saleId: string): Promise<BillingDocument | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("billing_documents").select("*,sales!billing_documents_sale_business_fk(reference)")
    .eq("business_id", businessId).eq("sale_id", saleId).eq("kind", "invoice").maybeSingle();
  if (error) { logError(error.code); throw new Error(FAILURE); }
  if (!data) return null;
  const result = document(data as unknown as Record<string, unknown>);
  const { data: credits, error: creditsError } = await supabase.from("billing_documents").select("total_incl_tax_cents")
    .eq("business_id", businessId).eq("original_invoice_id", result.id).eq("kind", "credit_note");
  if (creditsError) { logError(creditsError.code); throw new Error(FAILURE); }
  result.commercialState = billingCommercialState(result.kind, result.totalInclTaxCents, sumInvoiceCents((credits ?? []).map((credit) => credit.total_incl_tax_cents)));
  return result;
}

export async function getInvoiceCreationData(businessId: string, saleId: string) {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE);
  const [sale, settings, existing, businessSettings] = await Promise.all([
    getSale(businessId, saleId), getInvoiceSettings(businessId), getInvoiceForSale(businessId, saleId),
    supabase.from("business_settings").select("vat_regime").eq("business_id", businessId).maybeSingle(),
  ]);
  if (businessSettings.error) { logError(businessSettings.error.code); throw new Error(FAILURE); }
  return { sale, settings, existing, vatRegime: businessSettings.data?.vat_regime as VatRegime | undefined };
}
