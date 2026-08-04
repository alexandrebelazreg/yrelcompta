import type { Metadata } from "next";
import { signUpAction } from "@/app/actions";
import { AuthForm } from "@/components/auth/auth-form";
import { FormMessage } from "@/components/ui/form-message";
import { getSupabaseConfig, missingSupabaseMessage } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Inscription" };
export default function InscriptionPage() { return <><p className="eyebrow">Commencer sereinement</p><h1>Créer mon espace</h1><p className="auth-intro">Quelques instants suffisent pour préparer votre espace.</p>{!getSupabaseConfig() && <FormMessage message={missingSupabaseMessage} />}<AuthForm mode="signup" action={signUpAction} /></>; }
