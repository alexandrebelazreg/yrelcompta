"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { parseFrenchMoneyToCents } from "@/lib/sales/calculations";
import { createClient } from "@/lib/supabase/server";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const activitySchema = z.object({ activityStartedOn: dateSchema });
const declarationSchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
  declaredTurnover: z.string().min(1).transform((value, context) => {
    try { return parseFrenchMoneyToCents(value); }
    catch { context.addIssue({ code: "custom", message: "Montant invalide" }); return z.NEVER; }
  }),
  submittedOn: dateSchema,
  externalReference: z.string().trim().max(200),
  adjustmentReason: z.string().trim().max(1000),
});

async function mutationContext() {
  const [{ context }, supabase] = await Promise.all([getAuthenticatedContext(), createClient()]);
  if (!context.business || !supabase) return null;
  return { businessId: context.business.id, supabase };
}

function rpcMessage(code: string | undefined, message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";
  if (code === "42501") return "Vous n’avez pas l’autorisation d’effectuer cette action.";
  if (normalized.includes("activity start locked")) return "La date de début ne peut plus être modifiée après l’enregistrement d’une déclaration.";
  if (normalized.includes("period not ended")) return "Cette période n’est pas encore terminée.";
  if (normalized.includes("declaration submitted before period end")) return "La date de déclaration doit être postérieure à la fin de la période.";
  if (normalized.includes("adjustment reason") || normalized.includes("correction reason")) return "Un motif est obligatoire pour cet écart ou cette correction.";
  if (normalized.includes("already recorded")) return "Cette période possède déjà une déclaration enregistrée.";
  if (normalized.includes("submitted date")) return "La date de déclaration ne peut pas être future.";
  return "L’enregistrement a été refusé car les données sont incohérentes.";
}

export async function setActivityStartedOnAction(formData: FormData) {
  const parsed = activitySchema.safeParse({ activityStartedOn: formData.get("activityStartedOn") });
  if (!parsed.success) redirect("/registres/declarations?erreur=Date de début invalide");
  const context = await mutationContext();
  if (!context) redirect("/registres/declarations?erreur=Session indisponible");
  const { error } = await context.supabase.rpc("set_business_activity_started_on", {
    p_business_id: context.businessId,
    p_activity_started_on: parsed.data.activityStartedOn,
  });
  if (error) {
    console.error("Date de début d’activité refusée", { code: error.code });
    redirect(`/registres/declarations?erreur=${encodeURIComponent(rpcMessage(error.code, error.message))}`);
  }
  revalidatePath("/registres/declarations");
  redirect("/registres/declarations?message=date-enregistree");
}

async function saveDeclaration(formData: FormData, revision: boolean) {
  const parsed = declarationSchema.safeParse({
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    declaredTurnover: formData.get("declaredTurnover"),
    submittedOn: formData.get("submittedOn"),
    externalReference: formData.get("externalReference") ?? "",
    adjustmentReason: formData.get("adjustmentReason") ?? "",
  });
  const year = String(formData.get("year") ?? "");
  const returnPath = `/registres/declarations${/^\d{4}$/.test(year) ? `?annee=${year}` : ""}`;
  if (!parsed.success) redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}erreur=Vérifiez les champs de la déclaration`);
  const context = await mutationContext();
  if (!context) redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}erreur=Session indisponible`);
  const rpc = revision ? "revise_turnover_declaration" : "record_turnover_declaration";
  const { error } = await context.supabase.rpc(rpc, {
    p_business_id: context.businessId,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
    p_declared_turnover_cents: parsed.data.declaredTurnover,
    p_submitted_on: parsed.data.submittedOn,
    p_external_reference: parsed.data.externalReference || null,
    p_adjustment_reason: parsed.data.adjustmentReason || null,
  });
  if (error) {
    console.error("Déclaration YrelCompta refusée", { code: error.code });
    redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}erreur=${encodeURIComponent(rpcMessage(error.code, error.message))}`);
  }
  revalidatePath("/registres/declarations");
  redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}message=${revision ? "correction-enregistree" : "declaration-enregistree"}`);
}

export async function recordTurnoverDeclarationAction(formData: FormData) {
  return saveDeclaration(formData, false);
}

export async function reviseTurnoverDeclarationAction(formData: FormData) {
  return saveDeclaration(formData, true);
}
