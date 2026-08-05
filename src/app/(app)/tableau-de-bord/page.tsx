import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { formatEuroCents } from "@/lib/sales/calculations";
import { saleChannelLabels } from "@/lib/sales/labels";
import { getDashboardSales } from "@/lib/sales/queries";
import { formatFrenchDate } from "@/lib/utils/format";

export default async function DashboardPage() {
  const { context } = await getAuthenticatedContext(); const firstName = context.profile?.first_name || "Bienvenue";
  const dashboard = context.business ? await getDashboardSales(context.business.id) : { monthlyRevenueCents: 0, recentSales: [], hasSales: false };
  return <><header className="page-header"><div><p className="eyebrow">Tableau de bord</p><h1>{firstName === "Bienvenue" ? firstName : `Bonjour ${firstName}`}</h1><p>{context.business?.name}</p></div><span className="status-badge">✓ Configuration terminée</span></header><section className="metric-grid" aria-label="Indicateurs"><Card><p>Chiffre d’affaires encaissé</p><strong>{formatEuroCents(dashboard.monthlyRevenueCents)}</strong><small>Encaissements bruts moins remboursements du mois</small></Card><Card><p>Dépenses</p><strong>{formatEuroCents(0)}</strong><small>Fonctionnalité à venir</small></Card><Card><p>Cotisations estimées</p><strong>{formatEuroCents(0)}</strong><small>Aucun calcul pour le moment</small></Card><Card><p>Justificatifs manquants</p><strong>0</strong><small>Fonctionnalité à venir</small></Card></section>{!dashboard.hasSales ? <EmptyState title="Votre activité commence ici" description="Vos données apparaîtront sur ce tableau de bord après l’ajout de vos premières opérations." /> : <section className="recent-sales"><div className="section-heading"><div><p className="eyebrow">Activité récente</p><h2>Dernières ventes</h2></div><Link className="secondary-link" href="/ventes">Voir toutes les ventes</Link></div>{dashboard.recentSales.map((sale) => <Link href={`/ventes/${sale.id}`} className="recent-sale" key={sale.id}><div><strong>{sale.reference}</strong><span>{formatFrenchDate(sale.ordered_on)} · {saleChannelLabels[sale.channel]}</span></div><strong>{formatEuroCents(sale.total_cents)}</strong></Link>)}</section>}</>;
}
