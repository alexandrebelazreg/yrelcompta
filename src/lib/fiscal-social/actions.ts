"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

const fiscalProfileSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cfpCategory: z.enum(["commercial", "artisan"]),
  hasAcre: z.enum(["yes", "no"]),
  versementLiberatoire: z.enum(["yes", "no"]),
});

function fiscalProfileError(message: string | undefined): string {
  const value = message?.toLowerCase() ?? "";
  if (value.includes("owner access")) return "Seul le propriétaire peut configurer les paramètres fiscaux.";
  if (value.includes("activity start required")) return "Renseignez d’abord la date légale de début d’activité dans les déclarations.";
  if (value.includes("first fiscal profile")) return "La première version doit prendre effet à la date de début d’activité.";
  if (value.includes("january 1")) return "Une version suivante doit prendre effet un 1er janvier.";
  if (value.includes("must be future")) return "Une version suivante doit prendre effet à une date future.";
  if (value.includes("must increase")) return "La nouvelle date d’effet doit être postérieure à la version précédente.";
  if (value.includes("existing declaration")) return "Cette date modifierait une période déjà enregistrée et ne peut pas être utilisée.";
  return "La version fiscale a été refusée car les données sont incohérentes.";
}

export async function createFiscalProfileAction(formData: FormData) {
  const parsed = fiscalProfileSchema.safeParse({
    effectiveFrom: formData.get("effectiveFrom"),
    cfpCategory: formData.get("cfpCategory"),
    hasAcre: formData.get("hasAcre"),
    versementLiberatoire: formData.get("versementLiberatoire"),
  });
  if (!parsed.success) redirect("/parametres/fiscalite?erreur=Vérifiez les paramètres fiscaux");
  const [{ context }, supabase] = await Promise.all([getAuthenticatedContext(), createClient()]);
  if (!context.business || !supabase) redirect("/parametres/fiscalite?erreur=Session indisponible");
  const { error } = await supabase.rpc("create_business_fiscal_profile", {
    p_business_id: context.business.id,
    p_effective_from: parsed.data.effectiveFrom,
    p_cfp_category: parsed.data.cfpCategory,
    p_has_acre: parsed.data.hasAcre === "yes",
    p_versement_liberatoire: parsed.data.versementLiberatoire === "yes",
  });
  if (error) {
    console.error("Version fiscale refusée", { code: error.code });
    redirect(`/parametres/fiscalite?erreur=${encodeURIComponent(fiscalProfileError(error.message))}`);
  }
  revalidatePath("/parametres/fiscalite");
  revalidatePath("/tableau-de-bord");
  redirect("/parametres/fiscalite?message=version-enregistree");
}
