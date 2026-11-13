import Link from "next/link";
import { FlashToast } from "@/components/ui/flash-toast";
import { InfoTip } from "@/components/ui/info-tip";
import { SubmitButton } from "@/components/ui/submit-button";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { listProducts } from "@/lib/products/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { dismissShopifyAttentionAction, importShopifyHistoryAction, linkShopifyProductAction, reprocessShopifyImportAction, retryFailedShopifyEventsAction } from "@/lib/shopify/order-actions";
import { countFailedShopifyEvents, listShopifyOrderImports, productsToLink, type ShopifyImportStatus } from "@/lib/shopify/order-queries";
import { getShopifyConnectionStatus } from "@/lib/shopify/queries";
import { getTodayInParis } from "@/lib/utils/date";
import { formatFrenchDate } from "@/lib/utils/format";

const statusLabels: Record<ShopifyImportStatus, string> = {
  validated: "Vente validée",
  draft_incomplete: "Brouillon à compléter",
  waiting_payment: "En attente de paiement",
  needs_review: "À vérifier",
  cancelled: "Annulée",
  ignored: "Commande de test",
};

const attentionLabels: Record<string, { label: string; help: string }> = {
  unlinked_products: { label: "Produits à relier", help: "Reliez les produits ci-dessus : la vente sera validée automatiquement." },
  total_mismatch: { label: "Total à vérifier", help: "Le total Shopify ne correspond pas aux lignes, au port et à la remise. Vérifiez puis validez la vente à la main." },
  tax_present: { label: "TVA facturée", help: "La commande contient de la TVA, que YrelCompta ne gère pas encore : vérifiez la vente à la main." },
  currency: { label: "Devise autre que l’euro", help: "Seules les commandes en euros sont importées." },
  no_lines: { label: "Aucun article", help: "La commande ne contient aucun article importable." },
  refund_to_record: { label: "Remboursement à enregistrer", help: "Shopify a remboursé cette commande : enregistrez le remboursement sur la vente, puis marquez ce point comme traité." },
  order_cancelled: { label: "Annulée sur Shopify", help: "La vente est déjà validée : remboursez puis annulez-la dans YrelCompta si besoin, puis marquez ce point comme traité." },
};

const messages: Record<string, (q: Record<string, string>) => string> = {
  historique: (q) => `${q.importees ?? 0} commande(s) importée(s)${Number(q.echecs ?? 0) > 0 ? `, ${q.echecs} en échec` : ""}.`,
  relie: (q) => `Produit relié. ${q.relancees ?? 0} commande(s) mise(s) à jour.`,
  relancee: () => "La commande a été relancée.",
  traite: () => "Signalement marqué comme traité.",
  "relance-notifications": (q) => `${q.reussies ?? 0} commande(s) sur ${q.total ?? 0} importée(s).`,
};

function sixtyDaysAgo(today: string): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 60);
  return date.toISOString().slice(0, 10);
}

export default async function ShopifyOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ context }, raw] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const connection = await getShopifyConnectionStatus(context.business.id);
  const header = <>
    <Link className="back-link" href="/ventes">← Ventes</Link>
    <header className="page-header"><div className="info-line"><h1>Commandes Shopify</h1><InfoTip label="À propos des commandes Shopify">Chaque commande payée devient une vente du canal Shopify. Quand tous ses produits sont reliés et que les totaux concordent, la vente est validée et l’encaissement enregistré automatiquement.</InfoTip></div></header>
  </>;

  if (!connection) {
    return <>{header}<section className="card form-stack"><h2>Shopify n’est pas connecté</h2><p>Connectez votre boutique pour recevoir vos commandes en ventes.</p><Link className="button-link" href="/parametres/shopify">Connecter Shopify</Link></section></>;
  }

  const today = getTodayInParis();
  const [imports, products, failedEvents] = await Promise.all([
    listShopifyOrderImports(context.business.id),
    listProducts(context.business.id, { active: "active" }),
    countFailedShopifyEvents(context.business.id),
  ]);
  const toLink = productsToLink(imports);
  const toReview = imports.filter((entry) => entry.attention.some((flag) => flag !== "unlinked_products") || entry.status === "needs_review");
  const message = query.message && messages[query.message] ? messages[query.message](query) : null;

  return <>
    {header}
    {message && <FlashToast message={message}/>}
    {query.erreur && <p className="form-message" role="alert">{query.erreur}</p>}

    {failedEvents > 0 && <section className="card shopify-orders-alert">
      <p><strong>{failedEvents} notification(s) Shopify</strong> n’ont pas pu être importées (Shopify indisponible, produit supprimé…).</p>
      <form action={retryFailedShopifyEventsAction}><SubmitButton>Relancer l’import</SubmitButton></form>
    </section>}

    {toLink.length > 0 && <section className="card form-stack" aria-labelledby="to-link-heading">
      <div className="info-line"><h2 id="to-link-heading">Produits à relier ({toLink.length})</h2><InfoTip label="À propos de la liaison des produits">Reliez une fois chaque produit Shopify à son produit YrelCompta : le lien est mémorisé, et les ventes concernées sont complétées et validées automatiquement. Un SKU identique est relié sans intervention.</InfoTip></div>
      <ul className="shopify-link-list">{toLink.map((item) => <li key={item.variant_gid ?? item.product_gid}>
        <div><strong>{item.title}</strong><span className="compact-secondary-text">{item.sku ? `SKU ${item.sku} · ` : ""}{item.orderCount} commande(s)</span></div>
        <form action={linkShopifyProductAction} className="shopify-link-form">
          <input type="hidden" name="shopifyProductGid" value={item.product_gid ?? ""}/>
          <input type="hidden" name="shopifyVariantGid" value={item.variant_gid ?? ""}/>
          <input type="hidden" name="title" value={item.title}/>
          <input type="hidden" name="sku" value={item.sku ?? ""}/>
          <label className="sr-only" htmlFor={`link-${item.variant_gid ?? item.product_gid}`}>Produit YrelCompta pour {item.title}</label>
          <select className="input" id={`link-${item.variant_gid ?? item.product_gid}`} name="productId" required defaultValue="">
            <option value="" disabled>Choisir le produit…</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` (${product.sku})` : ""}</option>)}
          </select>
          <SubmitButton>Relier</SubmitButton>
        </form>
      </li>)}</ul>
      {products.length === 0 && <p className="form-message">Créez d’abord vos produits dans <Link href="/produits/nouveau">Produits</Link>.</p>}
    </section>}

    {toReview.length > 0 && <section className="card form-stack" aria-labelledby="review-heading">
      <h2 id="review-heading">Points à traiter ({toReview.length})</h2>
      <ul className="shopify-review-list">{toReview.map((entry) => <li key={entry.id}>
        <div><strong>{entry.order_name}</strong> · {formatFrenchDate(entry.ordered_on)} · {formatEuroCents(entry.total_cents)}{entry.sale_id && <> · <Link href={`/ventes/${entry.sale_id}`}>voir la vente {entry.sales?.reference ?? ""}</Link></>}</div>
        <ul>{entry.attention.filter((flag) => flag !== "unlinked_products").map((flag) => <li key={flag}>
          <span className="management-status management-status-overdue">{attentionLabels[flag]?.label ?? flag}</span> {attentionLabels[flag]?.help}
          {(flag === "refund_to_record" || flag === "order_cancelled") && <form action={dismissShopifyAttentionAction} className="table-inline-form"><input type="hidden" name="importId" value={entry.id}/><input type="hidden" name="flag" value={flag}/><SubmitButton>Marquer comme traité</SubmitButton></form>}
        </li>)}</ul>
        {entry.status !== "validated" && entry.status !== "cancelled" && <form action={reprocessShopifyImportAction} className="table-inline-form"><input type="hidden" name="importId" value={entry.id}/><SubmitButton>Relancer</SubmitButton></form>}
      </li>)}</ul>
    </section>}

    <section className="card form-stack" aria-labelledby="history-heading">
      <div className="info-line"><h2 id="history-heading">Importer les commandes passées</h2><InfoTip label="À propos de l’historique">Les commandes déjà importées ne sont jamais dupliquées. Shopify ne donne accès qu’aux 60 derniers jours, sauf si l’app dispose de la permission read_all_orders. Jusqu’à 500 commandes par import.</InfoTip></div>
      <form action={importShopifyHistoryAction} className="shopify-history-form">
        <div className="field"><label htmlFor="since">Commandes payées depuis le</label><input className="input" id="since" name="since" type="date" max={today} defaultValue={sixtyDaysAgo(today)} required/></div>
        <SubmitButton>Importer</SubmitButton>
      </form>
    </section>

    <section aria-labelledby="orders-heading" className="dashboard-section">
      <h2 id="orders-heading">Commandes reçues</h2>
      {imports.length === 0
        ? <p className="history-empty">Aucune commande pour l’instant. Les prochaines commandes payées apparaîtront ici automatiquement.</p>
        : <div className="register-table-wrap compact-table-wrap"><table className="register-table compact-table shopify-orders-table"><thead><tr><th>Commande</th><th>Date</th><th>Total</th><th>Statut</th><th>Vente</th></tr></thead><tbody>{imports.map((entry) => <tr key={entry.id}>
          <td className="compact-primary-cell shopify-order-main"><strong>{entry.order_name}</strong>{entry.attention.length > 0 && <span className="compact-secondary-text">{entry.attention.map((flag) => attentionLabels[flag]?.label ?? flag).join(" · ")}</span>}</td>
          <td>{formatFrenchDate(entry.ordered_on)}</td>
          <td className="compact-amount shopify-order-total">{formatEuroCents(entry.total_cents)}</td>
          <td className="shopify-order-status"><span className={`management-status management-status-${entry.status === "validated" ? "active" : entry.status === "draft_incomplete" || entry.status === "needs_review" ? "overdue" : "archived"}`}>{statusLabels[entry.status]}</span></td>
          <td>{entry.sale_id ? <Link className="compact-primary-link" href={`/ventes/${entry.sale_id}`}>{entry.sales?.reference ?? "Voir"}</Link> : "—"}</td>
          <td className="compact-mobile-context">{formatFrenchDate(entry.ordered_on)} · {statusLabels[entry.status]}</td>
        </tr>)}</tbody></table></div>}
    </section>
  </>;
}
