import Link from "next/link";
import { headers } from "next/headers";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { revokeConnectedAppAction } from "@/lib/mcp/consent-actions";
import { connectorLimits, connectorPermissions } from "@/lib/mcp/consent";
import { MCP_PATH } from "@/lib/mcp/metadata";
import { createClient } from "@/lib/supabase/server";
import { formatFrenchDate } from "@/lib/utils/format";

const messages: Record<string, string> = { revoquee: "L’accès de l’application a été retiré." };
const errors: Record<string, string> = { revocation: "Le retrait de l’accès a échoué. Réessayez.", application: "Application invalide.", configuration: "Supabase n’est pas configuré." };

export default async function ClaudeSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const connectorUrl = `${protocol}://${host}${MCP_PATH}`;

  const supabase = await createClient();
  const grants = supabase ? await supabase.auth.oauth.listGrants() : null;
  const connectedApps = grants && !grants.error ? grants.data ?? [] : null;
  const message = typeof params.message === "string" ? messages[params.message] : undefined;
  const error = typeof params.erreur === "string" ? errors[params.erreur] ?? errors.revocation : undefined;

  return <>
    <Link className="back-link" href="/parametres">← Paramètres</Link>
    <header className="page-header"><div className="info-line"><h1>Connecter Claude</h1><InfoTip label="À propos du connecteur Claude">Claude agit avec votre compte et voit uniquement les données de votre entreprise. Les règles d’accès de YrelCompta s’appliquent comme dans l’application.</InfoTip></div></header>
    {message && <p className="form-message success">{message}</p>}
    {error && <p className="form-message">{error}</p>}
    <section className="settings-grid">
      <Card>
        <h2>Ajouter YrelCompta dans Claude</h2>
        <ol className="connector-steps">
          <li>Dans Claude, ouvrez <strong>Paramètres → Connecteurs</strong> puis <strong>Ajouter un connecteur personnalisé</strong>.</li>
          <li>Nom : <strong>YrelCompta</strong>. Adresse du serveur : <code className="connector-url">{connectorUrl}</code></li>
          <li>Pour le client OAuth, choisissez <strong>l’enregistrement automatique</strong>.</li>
          <li>Connectez-vous avec votre compte YrelCompta, vérifiez la page d’autorisation puis cliquez sur <strong>Autoriser</strong>.</li>
        </ol>
      </Card>
      <Card>
        <h2>Ce que Claude peut faire</h2>
        <ul className="connector-list">{connectorPermissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
        <h2>Ce qu’il ne peut pas faire</h2>
        <ul className="connector-list">{connectorLimits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
        <p className="consent-note">Claude vous demande votre accord avant chaque création ou modification. Les écritures faites par Claude sont tracées dans le journal d’audit.</p>
      </Card>
    </section>
    <section className="dashboard-section" aria-labelledby="apps-heading">
      <h2 id="apps-heading">Applications connectées</h2>
      {connectedApps === null
        ? <p className="history-empty">La connexion d’applications n’est pas encore activée pour ce site.</p>
        : connectedApps.length === 0
          ? <p className="history-empty">Aucune application connectée.</p>
          : <div className="register-table-wrap compact-table-wrap"><table className="register-table compact-table connected-apps-table"><thead><tr><th>Application</th><th>Autorisée le</th><th>Actions</th></tr></thead><tbody>{connectedApps.map((grant) => <tr key={grant.client.id}><td className="compact-primary-cell connected-app-main">{grant.client.name || "Application sans nom"}</td><td>{formatFrenchDate(grant.granted_at.slice(0, 10))}</td><td className="compact-actions connected-app-actions"><form action={revokeConnectedAppAction}><input type="hidden" name="clientId" value={grant.client.id}/><ConfirmSubmitButton danger message="Retirer l’accès de cette application ? Elle devra être autorisée à nouveau.">Retirer l’accès</ConfirmSubmitButton></form></td><td className="compact-mobile-context">Autorisée le {formatFrenchDate(grant.granted_at.slice(0, 10))}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
