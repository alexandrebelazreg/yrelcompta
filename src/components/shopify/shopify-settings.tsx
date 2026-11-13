import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { InfoTip } from "@/components/ui/info-tip";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  connectShopifyAction,
  disconnectShopifyAction,
  testShopifyConnectionAction,
  verifyShopifyWebhooksAction,
} from "@/lib/shopify/actions";
import { SHOPIFY_REQUIRED_SCOPES } from "@/lib/shopify/constants";
import type { ShopifySyncStatus } from "@/lib/shopify/order-queries";
import type { ShopifyConnectionStatus } from "@/lib/shopify/types";

export function ShopifyCredentialsForm({ shopDomain = "", replacement = false }: { shopDomain?: string; replacement?: boolean }) {
  return <form action={connectShopifyAction} className="card form-stack shopify-credentials-form">
    <div className="info-line"><h2>{replacement ? "Remplacer les identifiants" : "Connecter ma boutique"}</h2><InfoTip label="Confidentialité des identifiants Shopify">Ces identifiants restent côté serveur et ne sont jamais affichés après enregistrement.</InfoTip></div>
    <div className="form-grid">
      <div className="field"><label htmlFor={replacement ? "replacementShopDomain" : "shopDomain"}>Boutique Shopify</label>{replacement ? <><input className="input" id="replacementShopDomain" value={shopDomain} readOnly aria-readonly="true"/><input type="hidden" name="shopDomain" value={shopDomain}/></> : <input className="input" id="shopDomain" name="shopDomain" defaultValue={shopDomain} placeholder="ma-boutique.myshopify.com" autoComplete="off" required/>}<p className="field-hint">L’adresse qui se termine par .myshopify.com (étape 5 du guide).</p></div>
      <div className="field"><label htmlFor={replacement ? "replacementClientId" : "clientId"}>Client ID (Shopify → Settings → Credentials)</label><input className="input" id={replacement ? "replacementClientId" : "clientId"} name="clientId" autoComplete="off" required/></div>
      <div className="field"><label htmlFor={replacement ? "replacementClientSecret" : "clientSecret"}>Client Secret (Shopify → Settings → Credentials)</label><input className="input" id={replacement ? "replacementClientSecret" : "clientSecret"} name="clientSecret" type="password" autoComplete="new-password" required/></div>
    </div>
    <SubmitButton>Connecter Shopify</SubmitButton>
  </form>;
}

export function ConnectedShopify({ status, sync }: { status: ShopifyConnectionStatus; sync: ShopifySyncStatus | null }) {
  const webhooksComplete = status.connection_status === "connected" && status.webhook_count === status.expected_webhook_count;
  const format = (value: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
  const verified = status.last_verified_at ? format(status.last_verified_at) : "Jamais";
  return <div className="form-stack shopify-settings-stack">
    <section className="card form-stack">
      <div className="section-heading"><div><p className="eyebrow">Shopify</p><h2>{status.shop_name}</h2></div><span className="management-status management-status-active">{webhooksComplete ? "● Connecté" : "● Connecté · synchronisation par l’API"}</span></div>
      <dl className="shopify-status-grid">
        <div><dt>Boutique</dt><dd>{status.shop_domain}</dd></div>
        <div><dt>Devise</dt><dd>{status.shop_currency}</dd></div>
        <div><dt>Client ID</dt><dd>{status.client_id_hint}</dd></div>
        <div><dt>Permissions</dt><dd>{SHOPIFY_REQUIRED_SCOPES.map((scope) => <span key={scope}>✓ {scope === "read_orders" ? "Commandes" : "Produits"}</span>)}</dd></div>
        <div><dt>Notifications instantanées</dt><dd>{webhooksComplete ? `✓ ${status.webhook_count}/5 actives` : `${status.webhook_count}/5 — remplacées par la synchronisation toutes les 15 minutes`}</dd></div>
        <div><dt>Dernière synchronisation</dt><dd>{sync?.lastSyncAt ? format(sync.lastSyncAt) : "Pas encore"}</dd></div>
        <div><dt>Dernière vérification</dt><dd>{verified}</dd></div>
      </dl>
      {!webhooksComplete && <p className="shopify-guide-note">Shopify n’a pas accordé les notifications instantanées à cette boutique (fréquent sur l’offre Basic, faute d’accès aux données clientes protégées). Ce n’est pas bloquant : YrelCompta récupère vos commandes automatiquement par l’API toutes les 15 minutes.{sync?.lastWebhookError ? ` Raison donnée par Shopify : « ${sync.lastWebhookError} ».` : ""}</p>}
      <div className="form-actions shopify-actions">
        <Link className="button-link" href="/ventes/shopify">Voir les commandes Shopify</Link>
        <form action={testShopifyConnectionAction}><SubmitButton>Tester la connexion</SubmitButton></form>
        <form action={verifyShopifyWebhooksAction}><SubmitButton>Réessayer les notifications</SubmitButton></form>
        <form action={disconnectShopifyAction}><ConfirmSubmitButton danger message="Déconnecter Shopify et supprimer les secrets enregistrés ?">Déconnecter Shopify</ConfirmSubmitButton></form>
      </div>
    </section>
    <details className="card shopify-replacement"><summary className="secondary-link">Remplacer les identifiants</summary><div><ShopifyCredentialsForm shopDomain={status.shop_domain} replacement/></div></details>
  </div>;
}
