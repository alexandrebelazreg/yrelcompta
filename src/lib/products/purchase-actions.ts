"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { materialPurchaseSchema, purchaseErrorMessage } from "./purchases";
import type { ProductActionState } from "./validation";

const PAGE = "/produits/matieres";
const id = z.string().uuid();

async function ctx() {
  const { userId, context } = await getAuthenticatedContext();
  const supabase = await createClient();
  if (!userId || !context.business || !supabase) return null;
  return { supabase, businessId: context.business.id };
}

function refresh() {
  revalidatePath(PAGE);
  revalidatePath("/produits", "layout");
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function addMaterialPurchaseAction(_: ProductActionState, form: FormData): Promise<ProductActionState> {
  const materialId = id.safeParse(form.get("materialId"));
  const parsed = materialPurchaseSchema.safeParse({ purchasedOn: text(form, "purchasedOn"), quantity: text(form, "quantity"), totalCost: text(form, "totalCost"), supplierId: text(form, "supplierId"), newSupplierName: text(form, "newSupplierName"), orderReference: text(form, "orderReference"), expenseId: "", excluded: form.get("excluded") === "on" });
  if (!materialId.success || !parsed.success) return { error: "Vérifiez la date, la quantité et le coût total de l’achat.", fieldErrors: parsed.success ? undefined : parsed.error.flatten().fieldErrors };
  const c = await ctx();
  if (!c) return { error: "Session indisponible." };
  const p = parsed.data;
  const { error } = await c.supabase.rpc("add_material_purchase", { p_business_id: c.businessId, p_material_id: materialId.data, p_purchased_on: p.purchasedOn, p_supplier_id: p.supplierId || null, p_new_supplier_name: p.newSupplierName || null, p_order_reference: p.orderReference || null, p_quantity_milliunits: p.quantity, p_total_cost_cents: p.totalCost, p_expense_id: null, p_excluded: p.excluded });
  if (error) {
    console.error("Ajout d’achat de matière refusé", { code: error.code });
    return { error: purchaseErrorMessage(error.code, error.message) };
  }
  refresh();
  if (p.newSupplierName) revalidatePath("/depenses/fournisseurs");
  redirect(`${PAGE}?message=achat`);
}

/** Inverse « exclure du calcul » d'un achat, sans toucher à ses autres informations. */
export async function toggleMaterialPurchaseExclusionAction(form: FormData) {
  const purchaseId = id.safeParse(form.get("purchaseId"));
  const c = await ctx();
  if (!purchaseId.success || !c) redirect(`${PAGE}?erreur=${encodeURIComponent("Achat invalide ou session expirée.")}`);
  const { data: current, error: readError } = await c.supabase.from("material_purchases").select("purchased_on,supplier_id,order_reference,quantity_milliunits,total_cost_cents,expense_id,excluded").eq("business_id", c.businessId).eq("id", purchaseId.data).maybeSingle();
  if (readError || !current) redirect(`${PAGE}?erreur=${encodeURIComponent("Achat introuvable.")}`);
  const { error } = await c.supabase.rpc("update_material_purchase", { p_purchase_id: purchaseId.data, p_business_id: c.businessId, p_purchased_on: current.purchased_on, p_supplier_id: current.supplier_id, p_new_supplier_name: null, p_order_reference: current.order_reference, p_quantity_milliunits: current.quantity_milliunits, p_total_cost_cents: current.total_cost_cents, p_expense_id: current.expense_id, p_excluded: !current.excluded });
  if (error) {
    console.error("Exclusion d’achat refusée", { code: error.code });
    redirect(`${PAGE}?erreur=${encodeURIComponent(purchaseErrorMessage(error.code, error.message))}`);
  }
  refresh();
  redirect(`${PAGE}?message=${current.excluded ? "achat-inclus" : "achat-exclu"}`);
}

export async function deleteMaterialPurchaseAction(form: FormData) {
  const purchaseId = id.safeParse(form.get("purchaseId"));
  const c = await ctx();
  if (!purchaseId.success || !c) redirect(`${PAGE}?erreur=${encodeURIComponent("Achat invalide ou session expirée.")}`);
  const { error } = await c.supabase.rpc("delete_material_purchase", { p_purchase_id: purchaseId.data, p_business_id: c.businessId });
  if (error) {
    console.error("Suppression d’achat refusée", { code: error.code });
    redirect(`${PAGE}?erreur=${encodeURIComponent(purchaseErrorMessage(error.code, error.message))}`);
  }
  refresh();
  redirect(`${PAGE}?message=achat-supprime`);
}
