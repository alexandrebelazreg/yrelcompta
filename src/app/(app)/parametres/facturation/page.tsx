import Link from "next/link";
import { SubmitButton } from "@/components/ui/submit-button";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { saveInvoiceSettingsAction } from "@/lib/invoicing/actions";
import { getInvoiceSettings } from "@/lib/invoicing/queries";

const exemptionDefault = "TVA non applicable, art. 293 B du CGI";

export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ context }, query] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const settings = await getInvoiceSettings(context.business.id);
  const message = query.message === "parametres-enregistres" ? "Paramètres de facturation enregistrés pour les futures factures." : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const field = (name: keyof NonNullable<typeof settings>, fallback = "") => settings ? (settings[name] as string | null) ?? "" : fallback;
  return <>
    <Link className="back-link" href="/parametres">← Paramètres</Link>
    <header className="page-header"><div><p className="eyebrow">Identité snapshotée</p><h1>Paramètres de facturation</h1><p>Ces valeurs s’appliqueront uniquement aux futures factures. Les documents déjà émis ne changeront jamais.</p></div></header>
    {message && <p className="form-message success" role="status">{message}</p>}{error && <p className="form-message" role="alert">{error}</p>}
    <p className="dashboard-note">Pour une entreprise individuelle, utilisez votre identité légale avec la mention EI / Entrepreneur individuel.</p>
    {!settings && <p className="dashboard-note">Les valeurs issues de l’entreprise ci-dessous sont de simples aides de préremplissage : vérifiez-les avant enregistrement.</p>}
    <form action={saveInvoiceSettingsAction} className="card form-stack invoice-settings-form">
      <div className="form-grid">
        <Field name="issuerLegalName" label="Nom légal / identité EI" value={field("issuerLegalName")} required/>
        <Field name="issuerTradeName" label="Nom commercial facultatif" value={field("issuerTradeName", context.business.name)}/>
        <Field name="issuerSiret" label="SIRET" value={field("issuerSiret", context.business.siret ?? "")} pattern="[0-9]{14}" required/>
        <Field name="issuerEmail" label="Email facultatif" value={field("issuerEmail")} type="email"/>
        <Field name="issuerPhone" label="Téléphone facultatif" value={field("issuerPhone")}/>
      </div>
      <Area name="issuerAddress" label="Adresse" value={field("issuerAddress", context.business.address ?? "")} required/>
      <Area name="issuerRegistrationDetails" label="Informations d’immatriculation facultatives" value={field("issuerRegistrationDetails")}/>
      <Area name="vatExemptionMention" label="Mention franchise de TVA" value={field("vatExemptionMention", exemptionDefault)} required/>
      <Area name="defaultPaymentTerms" label="Conditions de paiement B2B par défaut" value={field("defaultPaymentTerms")}/>
      <Area name="defaultEarlyPaymentDiscountTerms" label="Conditions d’escompte" value={field("defaultEarlyPaymentDiscountTerms")}/>
      <Area name="defaultLatePenaltyTerms" label="Texte des pénalités de retard" value={field("defaultLatePenaltyTerms")}/>
      <Area name="defaultRecoveryIndemnityText" label="Texte indemnité forfaitaire de recouvrement" value={field("defaultRecoveryIndemnityText")}/>
      <SubmitButton>Enregistrer les paramètres</SubmitButton>
    </form>
  </>;
}

function Field({ name, label, value, type = "text", required, pattern }: { name: string; label: string; value: string; type?: string; required?: boolean; pattern?: string }) {
  return <div className="field"><label htmlFor={name}>{label}</label><input className="input" id={name} name={name} type={type} defaultValue={value} required={required} pattern={pattern}/></div>;
}
function Area({ name, label, value, required }: { name: string; label: string; value: string; required?: boolean }) {
  return <div className="field"><label htmlFor={name}>{label}</label><textarea className="input" id={name} name={name} defaultValue={value} required={required}/></div>;
}
