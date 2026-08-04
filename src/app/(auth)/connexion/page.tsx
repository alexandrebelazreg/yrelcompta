import type { Metadata } from "next";
import { signInAction } from "@/app/actions";
import { AuthForm } from "@/components/auth/auth-form";
import { FormMessage } from "@/components/ui/form-message";
import { getSupabaseConfig, missingSupabaseMessage } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Connexion" };
export default function ConnexionPage() { return <><p className="eyebrow">Ravie de vous revoir</p><h1>Se connecter</h1><p className="auth-intro">Retrouvez votre espace de gestion YrelCompta.</p>{!getSupabaseConfig() && <FormMessage message={missingSupabaseMessage} />}<AuthForm mode="signin" action={signInAction} /></>; }
