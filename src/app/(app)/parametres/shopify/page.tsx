import { FlashToast } from "@/components/ui/flash-toast";
import Link from "next/link";
import { ShopifyGuide } from "@/components/shopify/shopify-guide";
import { ConnectedShopify, ShopifyCredentialsForm } from "@/components/shopify/shopify-settings";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { getShopifySyncStatus } from "@/lib/shopify/order-queries";
import { getShopifyConnectionStatus } from "@/lib/shopify/queries";

const messages: Record<string, string> = {
  connecte: "Shopify est connecté et les cinq webhooks sont actifs.",
  "connexion-verifiee": "La connexion Shopify fonctionne.",
  "webhooks-verifies": "Les notifications instantanées Shopify sont actives.",
  "connecte-api": "Shopify est connecté. Shopify n’a pas accordé les notifications instantanées à cette boutique : vos commandes seront récupérées automatiquement toutes les 15 minutes.",
  "webhooks-indisponibles": "Shopify refuse toujours les notifications instantanées pour cette boutique. Ce n’est pas bloquant : vos commandes sont récupérées automatiquement toutes les 15 minutes.",
  deconnecte: "Shopify est déconnecté et les secrets ont été supprimés.",
};

export default async function ShopifySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ context }, query] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const [status, sync] = await Promise.all([getShopifyConnectionStatus(context.business.id), getShopifySyncStatus(context.business.id)]);
  const message = typeof query.message === "string" ? messages[query.message] : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;

  return <>
    <Link className="back-link" href="/parametres">← Paramètres</Link>
    <header className="page-header"><div><p className="eyebrow">Intégration</p><h1>Shopify</h1><p>Reliez votre boutique Shopify à YrelCompta pour recevoir vos commandes. Suivez le guide ci-dessous, étape par étape.</p></div></header>
    {message && <FlashToast message={message}/>}
    {error && <p className="form-message" role="alert">{error}</p>}
    {status ? <><ConnectedShopify status={status} sync={sync}/><ShopifyGuide open={false}/></> : <><ShopifyGuide open/><ShopifyCredentialsForm/></>}
  </>;
}
