"use client";

import { useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { credentialsSchema, type ActionState } from "@/lib/auth/validation";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

type AuthAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function AuthForm({ mode, action }: { mode: "signin" | "signup"; action: AuthAction }) {
  const [state, formAction] = useActionState(action, {});
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>({});
  const signup = mode === "signup";

  function validate(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const result = credentialsSchema.safeParse({ email: data.get("email"), password: data.get("password") });
    if (!result.success) {
      event.preventDefault();
      setClientErrors(result.error.flatten().fieldErrors);
    } else setClientErrors({});
  }

  const errors = Object.keys(clientErrors).length ? clientErrors : state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={validate} className="form-stack" noValidate>
      <Field name="email" type="email" label="Adresse e-mail" autoComplete="email" required error={errors.email?.[0]} />
      <Field name="password" type="password" label="Mot de passe" autoComplete={signup ? "new-password" : "current-password"} minLength={8} required error={errors.password?.[0]} />
      <FormMessage message={state.error} />
      <FormMessage message={state.success} kind="success" />
      <SubmitButton>{signup ? "Créer mon espace" : "Se connecter"}</SubmitButton>
      <p className="form-alternative">
        {signup ? "Vous avez déjà un compte ? " : "Vous n’avez pas encore de compte ? "}
        <Link href={signup ? "/connexion" : "/inscription"}>{signup ? "Se connecter" : "Créer mon espace"}</Link>
      </p>
    </form>
  );
}
