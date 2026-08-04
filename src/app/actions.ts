"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { missingSupabaseMessage } from "@/lib/supabase/config";
import { credentialsSchema, onboardingSchema, type ActionState } from "@/lib/auth/validation";

function authError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login")) return "E-mail ou mot de passe incorrect.";
  if (normalized.includes("already registered") || normalized.includes("already exists")) return "Un compte existe déjà avec cette adresse e-mail.";
  if (normalized.includes("email not confirmed")) return "Confirmez d’abord votre adresse e-mail grâce au message reçu.";
  if (normalized.includes("rate limit")) return "Trop de tentatives. Réessayez dans quelques minutes.";
  return "L’opération n’a pas pu aboutir. Vérifiez vos informations et réessayez.";
}

function fields(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signInAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse(fields(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Corrigez les champs indiqués." };
  const supabase = await createClient();
  if (!supabase) return { error: missingSupabaseMessage };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authError(error.message) };

  const { data: membership } = await supabase.from("business_members").select("business_id").limit(1).maybeSingle();
  redirect(membership ? "/tableau-de-bord" : "/demarrage");
}

export async function signUpAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse(fields(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Corrigez les champs indiqués." };
  const supabase = await createClient();
  if (!supabase) return { error: missingSupabaseMessage };
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=/demarrage` },
  });
  if (error) return { error: authError(error.message) };
  if (data.session) redirect("/demarrage");
  return { success: "Compte créé. Consultez votre boîte e-mail pour confirmer votre adresse, puis connectez-vous." };
}

export async function onboardingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const values = {
    businessName: String(formData.get("businessName") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    siret: String(formData.get("siret") ?? "").replace(/\s/g, ""),
    address: String(formData.get("address") ?? ""),
    mainActivity: String(formData.get("mainActivity") ?? ""),
    declarationPeriod: String(formData.get("declarationPeriod") ?? ""),
    vatRegime: String(formData.get("vatRegime") ?? ""),
    hasAcre: String(formData.get("hasAcre") ?? ""),
  };
  const parsed = onboardingSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Corrigez les champs indiqués." };
  const supabase = await createClient();
  if (!supabase) return { error: missingSupabaseMessage };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Votre session a expiré. Reconnectez-vous." };

  const { error } = await supabase.rpc("complete_onboarding", {
    p_business_name: parsed.data.businessName,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_siret: parsed.data.siret || null,
    p_address: parsed.data.address || null,
    p_main_activity: parsed.data.mainActivity,
    p_declaration_period: parsed.data.declarationPeriod,
    p_vat_regime: parsed.data.vatRegime,
    p_has_acre: parsed.data.hasAcre === "yes",
  });
  if (error) {
    console.error("Échec de l’onboarding Supabase", { code: error.code });
    return { error: error.code === "23505" ? "Votre entreprise est déjà configurée." : "La création de l’entreprise a échoué. Réessayez." };
  }
  redirect("/tableau-de-bord");
}

export async function signOutAction() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/connexion");
}
