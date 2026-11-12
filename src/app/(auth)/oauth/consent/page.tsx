import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/ui/submit-button";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { approveAuthorizationAction, denyAuthorizationAction } from "@/lib/mcp/consent-actions";
import { connectorLimits, connectorPermissions, describeRedirect } from "@/lib/mcp/consent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Autoriser une application" };

const errors: Record<string, string> = {
  demande: "Cette demande d’autorisation est invalide ou a expiré. Relancez la connexion depuis Claude.",
  redirection: "L’adresse de retour de l’application est invalide. Relancez la connexion depuis Claude.",
  configuration: "Supabase n’est pas configuré.",
};

function Message({ title, text }: { title: string; text: string }) {
  return <><h1>{title}</h1><p className="auth-intro">{text}</p><Link className="secondary-link" href="/tableau-de-bord">Retour à YrelCompta</Link></>;
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (typeof params.erreur === "string") return <Message title="Autorisation impossible" text={errors[params.erreur] ?? errors.demande} />;
  const authorizationId = typeof params.authorization_id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(params.authorization_id) ? params.authorization_id : null;
  if (!authorizationId) return <Message title="Autorisation impossible" text={errors.demande} />;

  const { userId, email, context } = await getAuthenticatedContext();
  if (!userId) redirect(`/connexion?retour=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  if (!context.business) return <Message title="Entreprise non configurée" text="Terminez la configuration de votre entreprise avant de connecter une application." />;

  const supabase = await createClient();
  if (!supabase) return <Message title="Autorisation impossible" text={errors.configuration} />;
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    console.error("Lecture de la demande OAuth impossible", { code: error?.code });
    return <Message title="Autorisation impossible" text={errors.demande} />;
  }
  // Accord déjà donné à cette application : Supabase fournit directement l'adresse de retour.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  const destination = describeRedirect(data.redirect_uri);
  const clientName = data.client.name || "Application sans nom";

  return <>
    <p className="eyebrow">Autorisation d’accès</p>
    <h1>{clientName} souhaite accéder à YrelCompta</h1>
    <p className="auth-intro">Connectée en tant que <strong>{email}</strong> pour <strong>{context.business.name}</strong>.</p>
    {!destination.trusted && <p className="form-message">Attention : cette application ne renvoie pas vers Claude ({destination.host}). Refusez si vous n’êtes pas à l’origine de cette demande.</p>}
    <section className="consent-section">
      <h2>Cette application pourra</h2>
      <ul>{connectorPermissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
      <h2>Elle ne pourra pas</h2>
      <ul>{connectorLimits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
      <p className="consent-note">Après votre accord, vous serez renvoyée vers <strong>{destination.host}</strong>. Vous pourrez retirer cet accès à tout moment dans Paramètres → Claude.</p>
    </section>
    <div className="consent-actions">
      <form action={approveAuthorizationAction}><input type="hidden" name="authorizationId" value={data.authorization_id} /><SubmitButton>Autoriser</SubmitButton></form>
      <form action={denyAuthorizationAction}><input type="hidden" name="authorizationId" value={data.authorization_id} /><button className="secondary-link" type="submit">Refuser</button></form>
    </div>
  </>;
}
