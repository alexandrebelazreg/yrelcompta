import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { getSupabaseConfig, missingSupabaseMessage } from "@/lib/supabase/config";

export default async function DemarragePage() {
  if (!getSupabaseConfig()) return <main className="centered-message"><h1>Configuration requise</h1><p>{missingSupabaseMessage}</p></main>;
  const { userId, context } = await getAuthenticatedContext();
  if (!userId) redirect("/connexion");
  if (context.business) redirect("/tableau-de-bord");
  return <main className="onboarding-page"><header><span className="brand">YrelCompta</span><p>Configuration initiale</p></header><section className="onboarding-card"><p className="eyebrow">Bienvenue</p><h1>Parlez-nous de votre entreprise</h1><p>Ces informations structurent votre espace. Vous pourrez les faire évoluer plus tard.</p><OnboardingForm /></section></main>;
}
