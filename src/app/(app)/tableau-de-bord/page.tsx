import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { calculateDashboardMetrics, resolveDashboardMonth } from "@/lib/dashboard/calculations";
import { fixedCostCoverageMessage } from "@/lib/dashboard/presentation";
import { getDashboardData } from "@/lib/dashboard/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { saleChannelLabels } from "@/lib/sales/labels";
import { formatFrenchDate } from "@/lib/utils/format";
import type { BreakEvenUnavailableReason, DashboardMetrics, DashboardRecentSale } from "@/types/dashboard";

interface DashboardPageProps {
  searchParams: Promise<{ mois?: string | string[] }>;
}

const unavailableReasons: Record<BreakEvenUnavailableReason, string> = {
  "fixed-costs-not-configured": "Configurez vos charges récurrentes fixes pour calculer le seuil de rentabilité.",
  "no-reference-sales": "Aucune vente avec coût complet sur les 90 jours de référence.",
  "non-positive-reference-revenue": "Le chiffre d’affaires marchand de référence n’est pas positif.",
  "non-positive-reference-margin": "La marge de fabrication de référence n’est pas positive.",
};

function moneyOrUnavailable(amount: number | null): string {
  return amount === null ? "Indisponible" : formatEuroCents(amount);
}

function percentOrUnavailable(basisPoints: number | null): string {
  if (basisPoints === null) return "Indisponible";
  return new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .format(basisPoints / 10_000);
}

function MonthSelector({ monthKey }: { monthKey: string }) {
  return <form className="dashboard-month-form" method="get">
    <label htmlFor="dashboard-month">Mois affiché</label>
    <input className="input" id="dashboard-month" name="mois" type="month" defaultValue={monthKey} />
    <button className="button" type="submit">Afficher</button>
  </form>;
}

function DashboardContent({ metrics, recentSales }: { metrics: DashboardMetrics; recentSales: DashboardRecentSale[] }) {
  const profitabilityAvailable = metrics.profitability.completeCount > 0;
  const referenceAvailable = metrics.reference.saleCount > 0;
  const breakEvenReason = metrics.breakEven.unavailableReason
    ? unavailableReasons[metrics.breakEven.unavailableReason]
    : "Calculé à partir de la marge pondérée des 90 derniers jours du mois sélectionné.";

  return <>
    <section className="dashboard-section" aria-labelledby="cash-heading">
      <div className="section-heading"><div><p className="eyebrow">Flux réellement datés</p><h2 id="cash-heading">Trésorerie du mois</h2></div></div>
      <div className="metric-grid">
        <Card><p>Chiffre d’affaires encaissé</p><strong>{formatEuroCents(metrics.cash.revenueCollectedCents)}</strong><small>Brut encaissé moins remboursements clients</small></Card>
        <Card><p>Commissions</p><strong>{formatEuroCents(metrics.cash.platformFeesCents)}</strong><small>Suivies séparément, sans création de dépense</small></Card>
        <Card><p>Dépenses professionnelles nettes</p><strong>{formatEuroCents(metrics.cash.netExpensesCents)}</strong><small>Part professionnelle payée moins remboursements fournisseurs</small></Card>
        <Card><p>Flux net suivi</p><strong>{formatEuroCents(metrics.cash.trackedCashCents)}</strong><small>Encaissements nets de remboursements, moins commissions et dépenses professionnelles payées. Ce montant n’est pas un bénéfice comptable ou fiscal.</small></Card>
      </div>
      <p className="dashboard-note">Détail : {formatEuroCents(metrics.cash.grossCollectedCents)} encaissés, {formatEuroCents(metrics.cash.customerRefundedCents)} remboursés aux clientes, {formatEuroCents(metrics.cash.expensesPaidCents)} payés et {formatEuroCents(metrics.cash.expenseRefundedCents)} remboursés par les fournisseurs.</p>
    </section>

    <section className="dashboard-section" aria-labelledby="profitability-heading">
      <div className="section-heading"><div><p className="eyebrow">Ventes validées et snapshots historiques</p><h2 id="profitability-heading">Rentabilité de fabrication du mois</h2></div></div>
      <div className="metric-grid">
        <Card><p>Ventes marchandises avec coût complet</p><strong>{profitabilityAvailable ? formatEuroCents(metrics.profitability.completeMerchandiseRevenueCents) : "Indisponible"}</strong><small>Hors livraison, après remise</small></Card>
        <Card><p>Coût de fabrication historique</p><strong>{profitabilityAvailable ? formatEuroCents(metrics.profitability.manufacturingCostCents) : "Indisponible"}</strong><small>Snapshots complets uniquement</small></Card>
        <Card><p>Marge de fabrication historique</p><strong>{profitabilityAvailable ? formatEuroCents(metrics.profitability.manufacturingMarginCents) : "Indisponible"}</strong><small>Après remises, hors livraison, commissions, remboursements, cotisations, TVA et impôt.</small></Card>
        <Card><p>Taux de marge de fabrication</p><strong>{percentOrUnavailable(metrics.profitability.marginRateBasisPoints)}</strong><small>Marge ÷ chiffre d’affaires marchand couvert</small></Card>
      </div>
      <div className="snapshot-coverage">
        <strong>{metrics.profitability.completeCount} ventes avec coût complet sur {metrics.profitability.saleCount} ventes validées</strong>
        <span>{metrics.profitability.incompleteCount} incomplètes · {metrics.profitability.historicalCount} historiques non évaluées</span>
      </div>
    </section>

    <section className="dashboard-section" aria-labelledby="break-even-heading">
      <div className="section-heading"><div><p className="eyebrow">Prévision distincte des flux</p><h2 id="break-even-heading">Charges fixes et seuil de rentabilité</h2></div></div>
      <div className="metric-grid">
        <Card><p>Charges fixes estimées / mois</p><strong>{moneyOrUnavailable(metrics.fixedCosts.monthlyCents)}</strong><small>Estimation issue des charges récurrentes actives classées en charges fixes. {metrics.fixedCosts.annualCents === null ? "" : `${formatEuroCents(metrics.fixedCosts.annualCents)} par an.`}</small><Link className="card-link" href="/depenses/recurrences">Gérer les charges fixes</Link></Card>
        <Card><p>Taux de marge de fabrication de référence — 90 jours</p><strong>{referenceAvailable ? percentOrUnavailable(metrics.reference.marginRateBasisPoints) : "Indisponible"}</strong><small>{metrics.reference.saleCount} vente(s) complète(s) pondérée(s) par le chiffre d’affaires marchandises</small></Card>
        <Card><p>Seuil de rentabilité estimé</p><strong>{moneyOrUnavailable(metrics.breakEven.monthlyRevenueCents)}</strong><small>{breakEvenReason} Seuil de couverture des charges fixes par la marge de fabrication. Il exclut notamment les cotisations sociales, la TVA, l’impôt et les coûts commerciaux non inclus dans la marge produit.</small></Card>
        <Card><p>Écart après couverture des charges fixes</p><strong>{moneyOrUnavailable(metrics.fixedCostCoverage.deltaCents)}</strong><small>{fixedCostCoverageMessage(metrics.fixedCostCoverage.unavailableReason)}</small></Card>
      </div>
      <p className="dashboard-note">Les charges fixes sont annualisées depuis les modèles actifs, fixes et d’exploitation, puis ramenées au mois. Le seuil indique le chiffre d’affaires marchand mensuel nécessaire pour couvrir cette estimation avec la marge historique de référence.</p>
    </section>

    <section className="dashboard-section" aria-labelledby="documents-heading">
      <div className="section-heading"><div><p className="eyebrow">Suivi administratif</p><h2 id="documents-heading">Justificatifs manquants</h2></div><Link className="secondary-link" href="/documents">Ouvrir les documents</Link></div>
      <Card><p>Dépenses validées sans document</p><strong>{metrics.missingDocumentCount}</strong><small>Décompte global, indépendant du mois sélectionné</small></Card>
    </section>

    {recentSales.length === 0 ? <EmptyState title="Votre activité commence ici" description="Vos dernières ventes apparaîtront ici après leur création." /> : <section className="recent-sales">
      <div className="section-heading"><div><p className="eyebrow">Activité récente</p><h2>Dernières ventes</h2></div><Link className="secondary-link" href="/ventes">Voir toutes les ventes</Link></div>
      {recentSales.map((sale) => <Link href={`/ventes/${sale.id}`} className="recent-sale" key={sale.id}><div><strong>{sale.reference}</strong><span>{formatFrenchDate(sale.orderedOn)} · {saleChannelLabels[sale.channel]}</span></div><strong>{formatEuroCents(sale.totalCents)}</strong></Link>)}
    </section>}
  </>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [{ context }, params] = await Promise.all([getAuthenticatedContext(), searchParams]);
  const month = resolveDashboardMonth(params.mois);
  const firstName = context.profile?.first_name || "Bienvenue";

  let content: React.ReactNode;
  if (!context.business) {
    content = <EmptyState title="Entreprise non configurée" description="Terminez la configuration de votre entreprise pour afficher ses indicateurs." />;
  } else {
    let dashboard: { metrics: DashboardMetrics; recentSales: DashboardRecentSale[] } | null = null;
    try {
      const source = await getDashboardData(context.business.id, month);
      dashboard = { metrics: calculateDashboardMetrics(source), recentSales: source.recentSales };
    } catch {
      dashboard = null;
    }
    content = dashboard
      ? <DashboardContent metrics={dashboard.metrics} recentSales={dashboard.recentSales} />
      : <div className="dashboard-error" role="alert"><h2>Données indisponibles</h2><p>Le tableau de bord n’a pas pu être chargé. Aucun indicateur partiel n’est affiché. Réessayez dans quelques instants.</p></div>;
  }

  return <>
    <header className="page-header"><div><p className="eyebrow">Tableau de bord · {month.label}</p><h1>{firstName === "Bienvenue" ? firstName : `Bonjour ${firstName}`}</h1><p>{context.business?.name}</p></div><MonthSelector monthKey={month.key} /></header>
    {content}
  </>;
}
