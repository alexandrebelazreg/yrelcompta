import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SaleStatusBadge } from "@/components/sales/status-badge";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { calculateSaleFinancials, formatEuroCents } from "@/lib/sales/calculations";
import { saleChannelLabels, saleStatusLabels } from "@/lib/sales/labels";
import { getSalesOverview, listSales } from "@/lib/sales/queries";
import type { SaleChannel, SaleStatus } from "@/types/sales";

const statuses = Object.keys(saleStatusLabels) as SaleStatus[];
const channels = Object.keys(saleChannelLabels) as SaleChannel[];

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const status = typeof params.status === "string" && statuses.includes(params.status as SaleStatus) ? params.status as SaleStatus : undefined;
  const channel = typeof params.channel === "string" && channels.includes(params.channel as SaleChannel) ? params.channel as SaleChannel : undefined;
  const search = typeof params.recherche === "string" ? params.recherche : undefined;
  const [{ sales, totals }, filtered] = await Promise.all([getSalesOverview(context.business.id), listSales(context.business.id, { status, channel, search })]);
  return <><header className="page-header"><div><p className="eyebrow">Suivi commercial</p><h1>Ventes</h1><p>Suivez vos commandes, encaissements et remboursements.</p></div><Link className="button-link" href="/ventes/nouvelle">Nouvelle vente</Link></header>
    <section className="sales-summary" aria-label="Résumé des ventes"><Card><p>Ventes validées</p><strong>{formatEuroCents(totals.validatedSalesCents)}</strong></Card><Card><p>Encaissé brut</p><strong>{formatEuroCents(totals.grossPaidCents)}</strong></Card><Card><p>Remboursé</p><strong>{formatEuroCents(totals.refundedCents)}</strong></Card><Card><p>Commissions</p><strong>{formatEuroCents(totals.platformFeesCents)}</strong></Card><Card><p>Reste à encaisser</p><strong>{formatEuroCents(totals.remainingCents)}</strong></Card></section>
    <form className="sales-filters" method="get"><div className="field"><label htmlFor="filter-status">Statut</label><select className="input" id="filter-status" name="status" defaultValue={status ?? ""}><option value="">Tous</option>{statuses.map((value) => <option key={value} value={value}>{saleStatusLabels[value]}</option>)}</select></div><div className="field"><label htmlFor="filter-channel">Canal</label><select className="input" id="filter-channel" name="channel" defaultValue={channel ?? ""}><option value="">Tous</option>{channels.map((value) => <option key={value} value={value}>{saleChannelLabels[value]}</option>)}</select></div><div className="field filter-search"><label htmlFor="filter-search">Référence ou cliente</label><input className="input" id="filter-search" name="recherche" defaultValue={search} /></div><button className="secondary-link" type="submit">Filtrer</button></form>
    {filtered.length === 0 ? <EmptyState title={sales.length ? "Aucune vente ne correspond aux filtres" : "Aucune vente pour le moment"} description={sales.length ? "Modifiez ou réinitialisez vos critères de recherche." : "Créez votre première vente et enregistrez-la comme brouillon."} /> : <section className="sales-list" aria-label="Liste des ventes">{filtered.map((sale) => { const financials = calculateSaleFinancials(sale); return <Link href={`/ventes/${sale.id}`} className="sale-card" key={sale.id}><div className="sale-card-head"><div><strong>{sale.reference}</strong><span>{new Intl.DateTimeFormat("fr-FR").format(new Date(`${sale.ordered_on}T12:00:00`))} · {saleChannelLabels[sale.channel]}</span></div><SaleStatusBadge status={sale.status} /></div>{sale.customer_name && <p>Cliente : {sale.customer_name}</p>}<dl className="sale-card-amounts"><div><dt>Total</dt><dd>{formatEuroCents(sale.total_cents)}</dd></div><div><dt>Encaissé brut</dt><dd>{formatEuroCents(financials.grossPaidCents)}</dd></div><div><dt>Remboursé</dt><dd>{formatEuroCents(financials.refundedCents)}</dd></div><div><dt>Reste</dt><dd>{formatEuroCents(financials.remainingCents)}</dd></div></dl></Link>; })}</section>}
  </>;
}
