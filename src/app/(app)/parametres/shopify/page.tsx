import Link from "next/link";
import { ConnectedShopify, ShopifyCredentialsForm } from "@/components/shopify/shopify-settings";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { getShopifyConnectionStatus } from "@/lib/shopify/queries";

const messages: Record<string, string> = {
  connecte: "Shopify est connecté et les cinq webhooks sont actifs.",
  "connexion-verifiee": "La connexion Shopify fonctionne.",
  "webhooks-verifies": "Les webhooks Shopify ont été vérifiés.",
  deconnecte: "Shopify est déconnecté et les secrets ont été supprimés.",
};

export default async function ShopifySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ context }, query] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const status = await getShopifyConnectionStatus(context.business.id);
  const message = typeof query.message === "string" ? messages[query.message] : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;

  return <>
    <Link className="back-link" href="/parametres">← Paramètres</Link>
    <header className="page-header"><div><p className="eyebrow">Intégration</p><h1>Shopify</h1><p>Connectez votre boutique sans exposer ses identifiants.</p></div></header>
    {message && <p className="form-message success" role="status">{message}</p>}
    {error && <p className="form-message" role="alert">{error}</p>}
    {status ? <ConnectedShopify status={status}/> : <ShopifyCredentialsForm/>}
  </>;
}
