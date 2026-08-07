"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { cancellationSchema, paymentFormSchema, refundFormSchema, saleFormSchema, type SalesActionState } from "./validation";

function rpcError(code?: string, message?: string): string {
  const text = message?.toLowerCase() ?? "";
  if (text.includes("product_business_forbidden")) return "Ce produit appartient à une autre entreprise.";
  if (text.includes("product_not_found")) return "Produit introuvable.";
  if (text.includes("product_costing_failed")) return "Le calcul du coût de fabrication est impossible.";
  if (text.includes("monetary_overflow") || code === "22003") return "Le montant dépasse la limite monétaire autorisée.";
  if (text.includes("sale_already_validated")) return "Cette vente est déjà validée ou annulée.";
  if (text.includes("inconsistent_snapshot_data")) return "Les données historiques de coût sont incohérentes.";
  if (code === "42501") return "Vous n’avez pas l’autorisation d’effectuer cette action.";
  if (code === "P0002") return text.includes("payment") ? "Encaissement introuvable." : "Vente introuvable.";
  if (code === "40001") return "Les données ont changé simultanément. Rechargez la page et réessayez.";
  if (text.includes("draft required")) return "Cette action est réservée à une vente en brouillon.";
  if (text.includes("validated sale required")) return "La vente doit être validée et non annulée.";
  if (text.includes("payment exceeds")) return "Cet encaissement dépasserait le total de la vente.";
  if (text.includes("refund exceeds")) return "Le remboursement dépasse le montant encore remboursable.";
  if (text.includes("non-zero net payment")) return "La vente ne peut être annulée tant que son encaissement net n’est pas nul.";
  if (text.includes("billed_sale_requires_full_credit")) return "La vente facturée doit être intégralement couverte par des avoirs avant son annulation.";
  if (code === "22023" || code === "23514") return "Les données sont incohérentes. Vérifiez les montants et les dates.";
  return "Une erreur inattendue est survenue. Réessayez dans quelques instants.";
}

async function mutationContext(): Promise<{ businessId: string; supabase: NonNullable<Awaited<ReturnType<typeof createClient>>> } | { error: string }> {
  const { userId, context } = await getAuthenticatedContext();
  if (!userId) return { error: "Votre session a expiré. Reconnectez-vous." };
  if (!context.business) return { error: "Entreprise introuvable." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase n’est pas configuré." };
  return { businessId: context.business.id, supabase };
}

function parseItems(value: FormDataEntryValue | null): unknown[] {
  try { const parsed: unknown = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export async function saveSaleDraftAction(_: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const parsed = saleFormSchema.safeParse({
    saleId: formData.get("saleId") || undefined, orderedOn: formData.get("orderedOn"), channel: formData.get("channel"),
    customerName: formData.get("customerName"), notes: formData.get("notes"), shipping: formData.get("shipping"), discount: formData.get("discount"),
    items: parseItems(formData.get("items")),
  });
  if (!parsed.success) return { error: "Corrigez les champs indiqués.", fieldErrors: parsed.error.flatten().fieldErrors };
  const context = await mutationContext();
  if ("error" in context) return { error: context.error };
  const items = parsed.data.items.map((item) => ({ description: item.description, quantity: item.quantity, unit_price_cents: item.unitPrice, product_id: item.productId ?? null }));
  const rpcName = parsed.data.saleId ? "update_sale_draft" : "create_sale_draft";
  const args = {
    ...(parsed.data.saleId ? { p_sale_id: parsed.data.saleId } : {}), p_business_id: context.businessId, p_ordered_on: parsed.data.orderedOn,
    p_channel: parsed.data.channel, p_customer_name: parsed.data.customerName || null, p_notes: parsed.data.notes || null,
    p_shipping_cents: parsed.data.shipping, p_discount_cents: parsed.data.discount, p_items: items,
  };
  const { data, error } = await context.supabase.rpc(rpcName, args);
  if (error) { console.error("Mutation de vente refusée", { code: error.code }); return { error: rpcError(error.code, error.message) }; }
  const saleId = parsed.data.saleId ?? String(data);
  revalidatePath("/ventes"); revalidatePath(`/ventes/${saleId}`); revalidatePath("/tableau-de-bord");
  redirect(`/ventes/${saleId}?message=${parsed.data.saleId ? "brouillon-modifie" : "brouillon-cree"}`);
}

const idSchema = z.string().uuid();
async function basicSaleMutation(formData: FormData, rpcName: "delete_sale_draft" | "validate_sale") {
  const saleId = idSchema.safeParse(formData.get("saleId"));
  if (!saleId.success) redirect("/ventes?erreur=vente-invalide");
  const context = await mutationContext();
  if ("error" in context) redirect(`/ventes/${saleId.data}?erreur=session`);
  const { error } = await context.supabase.rpc(rpcName, { p_sale_id: saleId.data, p_business_id: context.businessId });
  if (error) { console.error("Action définitive sur vente refusée", { code: error.code }); redirect(`/ventes/${saleId.data}?erreur=${encodeURIComponent(rpcError(error.code, error.message))}`); }
  revalidatePath("/ventes"); revalidatePath("/tableau-de-bord");
  redirect(rpcName === "delete_sale_draft" ? "/ventes?message=brouillon-supprime" : `/ventes/${saleId.data}?message=vente-validee`);
}
export async function deleteSaleDraftAction(formData: FormData) { return basicSaleMutation(formData, "delete_sale_draft"); }
export async function validateSaleAction(formData: FormData) { return basicSaleMutation(formData, "validate_sale"); }

export async function recordPaymentAction(_: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const parsed = paymentFormSchema.safeParse({ saleId: formData.get("saleId"), receivedOn: formData.get("receivedOn"), bankDepositedOn: formData.get("bankDepositedOn"), grossAmount: formData.get("grossAmount"), platformFee: formData.get("platformFee"), method: formData.get("method"), externalReference: formData.get("externalReference"), notes: formData.get("notes") });
  if (!parsed.success) return { error: "Corrigez les champs indiqués.", fieldErrors: parsed.error.flatten().fieldErrors };
  const context = await mutationContext(); if ("error" in context) return { error: context.error };
  const { error } = await context.supabase.rpc("record_payment", { p_sale_id: parsed.data.saleId, p_business_id: context.businessId, p_received_on: parsed.data.receivedOn, p_bank_deposited_on: parsed.data.bankDepositedOn || null, p_gross_amount_cents: parsed.data.grossAmount, p_platform_fee_cents: parsed.data.platformFee, p_method: parsed.data.method, p_external_reference: parsed.data.externalReference || null, p_notes: parsed.data.notes || null });
  if (error) { console.error("Encaissement refusé", { code: error.code }); return { error: rpcError(error.code, error.message) }; }
  revalidatePath(`/ventes/${parsed.data.saleId}`); revalidatePath("/ventes"); revalidatePath("/tableau-de-bord"); redirect(`/ventes/${parsed.data.saleId}?message=encaissement-ajoute`);
}

export async function recordRefundAction(_: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const parsed = refundFormSchema.safeParse({ paymentId: formData.get("paymentId"), saleId: formData.get("saleId"), refundedOn: formData.get("refundedOn"), amount: formData.get("amount"), kind: formData.get("kind"), reason: formData.get("reason") });
  if (!parsed.success) return { error: "Corrigez les champs indiqués.", fieldErrors: parsed.error.flatten().fieldErrors };
  const context = await mutationContext(); if ("error" in context) return { error: context.error };
  const { error } = await context.supabase.rpc("record_refund", { p_payment_id: parsed.data.paymentId, p_sale_id: parsed.data.saleId, p_business_id: context.businessId, p_refunded_on: parsed.data.refundedOn, p_amount_cents: parsed.data.amount, p_kind: parsed.data.kind, p_reason: parsed.data.reason });
  if (error) { console.error("Remboursement refusé", { code: error.code }); return { error: rpcError(error.code, error.message) }; }
  revalidatePath(`/ventes/${parsed.data.saleId}`); revalidatePath("/ventes"); revalidatePath("/tableau-de-bord"); redirect(`/ventes/${parsed.data.saleId}?message=remboursement-ajoute`);
}

export async function cancelSaleAction(_: SalesActionState, formData: FormData): Promise<SalesActionState> {
  const parsed = cancellationSchema.safeParse({ saleId: formData.get("saleId"), reason: formData.get("reason") });
  if (!parsed.success) return { error: "Le motif d’annulation est obligatoire.", fieldErrors: parsed.error.flatten().fieldErrors };
  const context = await mutationContext(); if ("error" in context) return { error: context.error };
  const { error } = await context.supabase.rpc("cancel_sale", { p_sale_id: parsed.data.saleId, p_business_id: context.businessId, p_reason: parsed.data.reason });
  if (error) { console.error("Annulation refusée", { code: error.code }); return { error: rpcError(error.code, error.message) }; }
  revalidatePath(`/ventes/${parsed.data.saleId}`); revalidatePath("/ventes"); revalidatePath("/tableau-de-bord"); redirect(`/ventes/${parsed.data.saleId}?message=vente-annulee`);
}
