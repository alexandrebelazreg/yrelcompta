"use client";

import { useActionState, useState, type FormEvent } from "react";
import { onboardingAction } from "@/app/actions";
import { onboardingSchema } from "@/lib/auth/validation";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

export function OnboardingForm() {
  const [state, action] = useActionState(onboardingAction, {});
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>({});
  function validate(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const result = onboardingSchema.safeParse({
      businessName: data.get("businessName"), firstName: data.get("firstName"), lastName: data.get("lastName"),
      siret: String(data.get("siret") ?? "").replace(/\s/g, ""), address: data.get("address"), mainActivity: data.get("mainActivity"),
      declarationPeriod: data.get("declarationPeriod"), vatRegime: data.get("vatRegime"), hasAcre: data.get("hasAcre"),
    });
    if (!result.success) { event.preventDefault(); setClientErrors(result.error.flatten().fieldErrors); }
    else setClientErrors({});
  }
  const e = Object.keys(clientErrors).length ? clientErrors : state.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={validate} className="form-stack onboarding-form" noValidate>
      <div className="form-grid">
        <Field name="businessName" label="Nom commercial" required maxLength={120} error={e.businessName?.[0]} />
        <Field name="siret" label="SIRET (facultatif)" inputMode="numeric" pattern="[0-9 ]{14,17}" error={e.siret?.[0]} />
        <Field name="firstName" label="Prénom" autoComplete="given-name" required error={e.firstName?.[0]} />
        <Field name="lastName" label="Nom" autoComplete="family-name" required error={e.lastName?.[0]} />
      </div>
      <TextareaField name="address" label="Adresse professionnelle (facultative)" autoComplete="street-address" error={e.address?.[0]} />
      <Field name="mainActivity" label="Activité principale" defaultValue="Création et vente de bijoux" required error={e.mainActivity?.[0]} />
      <div className="form-grid">
        <div className="field"><label htmlFor="declarationPeriod">Périodicité de déclaration</label><select className="input" id="declarationPeriod" name="declarationPeriod" defaultValue="monthly"><option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option></select></div>
        <div className="field"><label htmlFor="vatRegime">Régime de TVA</label><select className="input" id="vatRegime" name="vatRegime" defaultValue="franchise"><option value="franchise">Franchise en base</option><option value="liable">Assujettie</option></select></div>
        <div className="field"><label htmlFor="hasAcre">Bénéficiez-vous de l’ACRE ?</label><select className="input" id="hasAcre" name="hasAcre" defaultValue="no"><option value="no">Non</option><option value="yes">Oui</option></select></div>
      </div>
      <FormMessage message={state.error} />
      <SubmitButton>Terminer la configuration</SubmitButton>
    </form>
  );
}
