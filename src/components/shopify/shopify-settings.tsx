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
import type { ShopifyConnectionStatus } from "@/lib/shopify/types";

export function ShopifyCredentialsForm({ shopDomain = "", replacement = false }: { shopDomain?: string; replacement?: boolean }) {
  return <form action={connectShopifyAction} className="card form-stack shopify-credentials-form">
    <div className="info-line"><h2>{replacement ? "Remplacer les identifiants" : "Non connecté"}</h2><InfoTip label="Confidentialité des identifiants Shopify">Ces identifiants restent côté serveur et ne sont jamais affichés après enregistrement.</InfoTip></div>
    <div className="form-grid">
      <div className="field"><label htmlFor={replacement ? "replacementShopDomain" : "shopDomain"}>Boutique Shopify</label>{replacement ? <><input className="input" id="replacementShopDomain" value={shopDomain} readOnly aria-readonly="true"/><input type="hidden" name="shopDomain" value={shopDomain}/></> : <input className="input" id="shopDomain" name="shopDomain" defaultValue={shopDomain} placeholder="ma-boutique.myshopify.com" autoComplete="off" required/>}</div>
      <div className="field"><label htmlFor={replacement ? "replacementClientId" : "clientId"}>Client ID</label><input className="input" id={replacement ? "replacementClientId" : "clientId"} name="clientId" autoComplete="off" required/></div>
      <div className="field"><label htmlFor={replacement ? "replacementClientSecret" : "clientSecret"}>Client Secret</label><input className="input" id={replacement ? "replacementClientSecret" : "clientSecret"} name="clientSecret" type="password" autoComplete="new-password" required/></div>
    </div>
    <SubmitButton>Connecter Shopify</SubmitButton>
  </form>;
}

export function ConnectedShopify({ status }: { status: ShopifyConnectionStatus }) {
  const connected = status.connection_status === "connected" && status.webhook_count === status.expected_webhook_count;
  const verified = status.last_verified_at
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(status.last_verified_at))
    : "Jamais";
  return <div className="form-stack shopify-settings-stack">
    <section className="card form-stack">
      <div className="section-heading"><div><p className="eyebrow">Shopify</p><h2>{status.shop_name}</h2></div><span className={`management-status management-status-${connected ? "active" : "archived"}`}>{connected ? "● Connecté" : "Webhooks incomplets"}</span></div>
      <dl className="shopify-status-grid">
        <div><dt>Boutique</dt><dd>{status.shop_domain}</dd></div>
        <div><dt>Devise</dt><dd>{status.shop_currency}</dd></div>
        <div><dt>Client ID</dt><dd>{status.client_id_hint}</dd></div>
        <div><dt>Permissions</dt><dd>{SHOPIFY_REQUIRED_SCOPES.map((scope) => <span key={scope}>✓ {scope === "read_orders" ? "Commandes" : "Produits"}</span>)}</dd></div>
        <div><dt>Webhooks</dt><dd>{status.webhook_count === 5 ? "✓" : "À vérifier"} {status.webhook_count}/5 actifs</dd></div>
        <div><dt>Dernière vérification</dt><dd>{verified}</dd></div>
      </dl>
      <div className="form-actions shopify-actions">
        <form action={testShopifyConnectionAction}><SubmitButton>Tester la connexion</SubmitButton></form>
        <form action={verifyShopifyWebhooksAction}><SubmitButton>Vérifier les webhooks</SubmitButton></form>
        <form action={disconnectShopifyAction}><ConfirmSubmitButton danger message="Déconnecter Shopify et supprimer les secrets enregistrés ?">Déconnecter Shopify</ConfirmSubmitButton></form>
      </div>
    </section>
    <details className="card shopify-replacement"><summary className="secondary-link">Remplacer les identifiants</summary><div><ShopifyCredentialsForm shopDomain={status.shop_domain} replacement/></div></details>
  </div>;
}
