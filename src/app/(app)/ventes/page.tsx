import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
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
  return <><header className="page-header"><div className="info-line"><h1>Ventes</h1><InfoTip label="À propos du suivi des ventes">Suivez vos commandes, encaissements et remboursements.</InfoTip></div><Link className="button-link" href="/ventes/nouvelle">Nouvelle vente</Link></header>
    <section className="sales-summary" aria-label="Résumé des ventes"><Card><p>Ventes validées</p><strong>{formatEuroCents(totals.validatedSalesCents)}</strong></Card><Card><p>Encaissé brut</p><strong>{formatEuroCents(totals.grossPaidCents)}</strong></Card><Card><p>Remboursé</p><strong>{formatEuroCents(totals.refundedCents)}</strong></Card><Card><p>Commissions</p><strong>{formatEuroCents(totals.platformFeesCents)}</strong></Card><Card><p>Reste à encaisser</p><strong>{formatEuroCents(totals.remainingCents)}</strong></Card></section>
    <form className="sales-filters" method="get"><div className="field"><label htmlFor="filter-status">Statut</label><select className="input" id="filter-status" name="status" defaultValue={status ?? ""}><option value="">Tous</option>{statuses.map((value) => <option key={value} value={value}>{saleStatusLabels[value]}</option>)}</select></div><div className="field"><label htmlFor="filter-channel">Canal</label><select className="input" id="filter-channel" name="channel" defaultValue={channel ?? ""}><option value="">Tous</option>{channels.map((value) => <option key={value} value={value}>{saleChannelLabels[value]}</option>)}</select></div><div className="field filter-search"><label htmlFor="filter-search">Référence ou cliente</label><input className="input" id="filter-search" name="recherche" defaultValue={search} /></div><button className="secondary-link" type="submit">Filtrer</button></form>
    {filtered.length === 0 ? <EmptyState title={sales.length ? "Aucune vente ne correspond aux filtres" : "Aucune vente pour le moment"} description={sales.length ? "Modifiez ou réinitialisez vos critères de recherche." : "Créez votre première vente et enregistrez-la comme brouillon."} /> : <div className="register-table-wrap sales-table-wrap"><table className="register-table sales-table"><thead><tr><th>Référence</th><th>Date</th><th>Cliente</th><th>Canal</th><th>Statut</th><th>Total</th><th>Encaissé</th><th>Remboursé</th><th>Reste</th></tr></thead><tbody>{filtered.map((sale) => { const financials = calculateSaleFinancials(sale); const orderedOn = new Intl.DateTimeFormat("fr-FR").format(new Date(`${sale.ordered_on}T12:00:00`)); return <tr key={sale.id}><td className="sale-main"><Link className="sale-reference-link" href={`/ventes/${sale.id}`}>{sale.reference}</Link></td><td className="sale-date">{orderedOn}</td><td className="sale-customer">{sale.customer_name ?? "—"}</td><td className="sale-channel">{saleChannelLabels[sale.channel]}</td><td className="sale-status-cell"><SaleStatusBadge status={sale.status} /></td><td className="sale-amount sale-total">{formatEuroCents(sale.total_cents)}</td><td className="sale-amount sale-gross">{formatEuroCents(financials.grossPaidCents)}</td><td className="sale-amount sale-refunded">{formatEuroCents(financials.refundedCents)}</td><td className="sale-amount sale-remaining">{formatEuroCents(financials.remainingCents)}</td><td className="sale-mobile-context">{orderedOn} · {sale.customer_name ?? "Sans cliente"} · {saleChannelLabels[sale.channel]}</td><td className="sale-mobile-financials">Encaissé {formatEuroCents(financials.grossPaidCents)} · Remboursé {formatEuroCents(financials.refundedCents)} · Reste {formatEuroCents(financials.remainingCents)}</td></tr>; })}</tbody></table></div>}
  </>;
}
