import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/ui/metric-card";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { calculateDashboardMetrics, resolveDashboardMonth } from "@/lib/dashboard/calculations";
import { fixedCostCoverageMessage } from "@/lib/dashboard/presentation";
import { getDashboardData } from "@/lib/dashboard/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { saleChannelLabels } from "@/lib/sales/labels";
import { formatFrenchDate } from "@/lib/utils/format";
import type { BreakEvenUnavailableReason, DashboardMetrics, DashboardRecentSale } from "@/types/dashboard";
import { fiscalReserveUnavailableMessages, formatBasisPoints } from "@/lib/fiscal-social/presentation";

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

function DashboardSectionHeading({ id, title, help, action }: { id: string; title: string; help?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="section-heading dashboard-section-heading"><div className="info-line"><h2 id={id}>{title}</h2>{help && <InfoTip label={`En savoir plus sur ${title}`}>{help}</InfoTip>}</div>{action}</div>;
}

function DashboardContent({ metrics, recentSales }: { metrics: DashboardMetrics; recentSales: DashboardRecentSale[] }) {
  const profitabilityAvailable = metrics.profitability.completeCount > 0;
  const referenceAvailable = metrics.reference.saleCount > 0;
  const breakEvenReason = metrics.breakEven.unavailableReason
    ? unavailableReasons[metrics.breakEven.unavailableReason]
    : "Calculé à partir de la marge pondérée des 90 derniers jours du mois sélectionné.";

  return <>
    <section className="dashboard-section" aria-labelledby="cash-heading">
      <DashboardSectionHeading id="cash-heading" title="Trésorerie du mois" help={<>Détail : {formatEuroCents(metrics.cash.grossCollectedCents)} encaissés, {formatEuroCents(metrics.cash.customerRefundedCents)} remboursés aux clientes, {formatEuroCents(metrics.cash.expensesPaidCents)} payés et {formatEuroCents(metrics.cash.expenseRefundedCents)} remboursés par les fournisseurs.</>} />
      <div className="metric-grid">
        <MetricCard label="Chiffre d’affaires encaissé" value={formatEuroCents(metrics.cash.revenueCollectedCents)} help="Brut encaissé moins remboursements clients." />
        <MetricCard label="Commissions" value={formatEuroCents(metrics.cash.platformFeesCents)} help="Suivies séparément, sans création de dépense." />
        <MetricCard label="Dépenses professionnelles nettes" value={formatEuroCents(metrics.cash.netExpensesCents)} help="Part professionnelle payée moins remboursements fournisseurs." />
        <MetricCard label="Flux net suivi" value={formatEuroCents(metrics.cash.trackedCashCents)} help="Encaissements nets de remboursements, moins commissions et dépenses professionnelles payées. Ce montant n’est pas un bénéfice comptable ou fiscal." />
      </div>
    </section>

    <section className="dashboard-section" aria-labelledby="profitability-heading">
      <DashboardSectionHeading id="profitability-heading" title="Rentabilité de fabrication du mois" help="Indicateurs issus des ventes validées et de leurs snapshots historiques." />
      <div className="metric-grid">
        <MetricCard label="Ventes marchandises avec coût complet" value={profitabilityAvailable ? formatEuroCents(metrics.profitability.completeMerchandiseRevenueCents) : "Indisponible"} help="Hors livraison, après remise." />
        <MetricCard label="Coût de fabrication historique" value={profitabilityAvailable ? formatEuroCents(metrics.profitability.manufacturingCostCents) : "Indisponible"} help="Snapshots complets uniquement." />
        <MetricCard label="Marge de fabrication historique" value={profitabilityAvailable ? formatEuroCents(metrics.profitability.manufacturingMarginCents) : "Indisponible"} help="Après remises, hors livraison, commissions, remboursements, cotisations, TVA et impôt." />
        <MetricCard label="Taux de marge de fabrication" value={percentOrUnavailable(metrics.profitability.marginRateBasisPoints)} help="Marge divisée par le chiffre d’affaires marchand couvert." />
      </div>
      <div className="snapshot-coverage">
        <strong>{metrics.profitability.completeCount} ventes avec coût complet sur {metrics.profitability.saleCount} ventes validées</strong>
        <span>{metrics.profitability.incompleteCount} incomplètes · {metrics.profitability.historicalCount} historiques non évaluées</span>
      </div>
    </section>

    <section className="dashboard-section" aria-labelledby="fiscal-reserve-heading">
      <DashboardSectionHeading id="fiscal-reserve-heading" title="Réserve fiscale et sociale estimée" help="Estimation interne de trésorerie uniquement. Hors CFE, TVA et impôt sur le revenu au barème progressif. YrelCompta ne transmet aucune déclaration." action={<Link className="secondary-link" href="/parametres/fiscalite">Gérer les paramètres fiscaux</Link>} />
      {metrics.fiscalReserve.calculation ? <>
        <div className="metric-grid">
          <MetricCard label="CA encaissé utilisé comme base" value={formatEuroCents(metrics.fiscalReserve.calculation.turnoverCents)} help="Encaissements bruts du mois, sans remboursement client." />
          <MetricCard label="Cotisations sociales estimées" value={formatEuroCents(metrics.fiscalReserve.calculation.estimatedSocialContributionsCents)} help={<>Taux effectif {formatBasisPoints(metrics.fiscalReserve.calculation.socialRateBasisPoints)}{metrics.fiscalReserve.calculation.acreApplied ? " avec ACRE" : ""}.</>} />
          <MetricCard label="CFP estimée" value={formatEuroCents(metrics.fiscalReserve.calculation.estimatedCfpCents)} help={<>Taux {formatBasisPoints(metrics.fiscalReserve.calculation.cfpRateBasisPoints)}, jamais réduit par l’ACRE.</>} />
          {metrics.fiscalReserve.calculation.versementLiberatoireBasisPoints > 0 && <MetricCard label="Versement libératoire estimé" value={formatEuroCents(metrics.fiscalReserve.calculation.estimatedIncomeTaxCents)} help={<>Taux {formatBasisPoints(metrics.fiscalReserve.calculation.versementLiberatoireBasisPoints)}.</>} />}
          <MetricCard label="Réserve totale estimée" value={formatEuroCents(metrics.fiscalReserve.calculation.estimatedTotalReserveCents)} help="Cotisations sociales, CFP et versement libératoire activé." />
          <MetricCard label="Flux net suivi après réserve estimée" value={moneyOrUnavailable(metrics.fiscalReserve.trackedCashAfterReserveCents)} help="Flux net suivi actuel moins cette réserve. Ce n’est ni un bénéfice net, ni le montant réellement dû." />
        </div>
      </> : <div className="card fiscal-reserve-unavailable"><strong>Estimation indisponible</strong><p>{metrics.fiscalReserve.unavailableReason ? fiscalReserveUnavailableMessages[metrics.fiscalReserve.unavailableReason] : "Données indisponibles."}</p></div>}
    </section>

    <section className="dashboard-section" aria-labelledby="break-even-heading">
      <DashboardSectionHeading id="break-even-heading" title="Charges fixes et seuil de rentabilité" help="Les charges fixes sont annualisées depuis les modèles actifs, fixes et d’exploitation, puis ramenées au mois. Le seuil indique le chiffre d’affaires marchand mensuel nécessaire pour couvrir cette estimation avec la marge historique de référence." />
      <div className="metric-grid">
        <MetricCard label="Charges fixes estimées / mois" value={moneyOrUnavailable(metrics.fixedCosts.monthlyCents)} help="Estimation issue des charges récurrentes actives classées en charges fixes." secondary={metrics.fixedCosts.annualCents === null ? undefined : `${formatEuroCents(metrics.fixedCosts.annualCents)} par an`} action={<Link className="card-link" href="/depenses/recurrences">Gérer les charges fixes</Link>} />
        <MetricCard label="Taux de marge de fabrication de référence — 90 jours" value={referenceAvailable ? percentOrUnavailable(metrics.reference.marginRateBasisPoints) : "Indisponible"} help={`${metrics.reference.saleCount} vente(s) complète(s) pondérée(s) par le chiffre d’affaires marchandises.`} />
        <MetricCard label="Seuil de rentabilité estimé" value={moneyOrUnavailable(metrics.breakEven.monthlyRevenueCents)} help="Seuil de couverture des charges fixes par la marge de fabrication. Il exclut notamment les cotisations sociales, la TVA, l’impôt et les coûts commerciaux non inclus dans la marge produit." secondary={metrics.breakEven.monthlyRevenueCents === null ? breakEvenReason : undefined} />
        <MetricCard label="Écart après couverture des charges fixes" value={moneyOrUnavailable(metrics.fixedCostCoverage.deltaCents)} help={metrics.fixedCostCoverage.deltaCents === null ? undefined : fixedCostCoverageMessage(metrics.fixedCostCoverage.unavailableReason)} secondary={metrics.fixedCostCoverage.deltaCents === null ? fixedCostCoverageMessage(metrics.fixedCostCoverage.unavailableReason) : undefined} />
      </div>
    </section>

    <section className="dashboard-section" aria-labelledby="documents-heading">
      <DashboardSectionHeading id="documents-heading" title="Justificatifs manquants" action={<Link className="secondary-link" href="/documents">Ouvrir les documents</Link>} />
      <MetricCard label="Dépenses validées sans document" value={metrics.missingDocumentCount} help="Décompte global, indépendant du mois sélectionné." />
    </section>

    {recentSales.length === 0 ? <EmptyState title="Votre activité commence ici" description="Vos dernières ventes apparaîtront ici après leur création." /> : <section className="recent-sales">
      <div className="section-heading"><h2>Dernières ventes</h2><Link className="secondary-link" href="/ventes">Voir toutes les ventes</Link></div>
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
    <header className="page-header"><div><h1>{firstName === "Bienvenue" ? firstName : `Bonjour ${firstName}`}</h1><p>{context.business?.name} · {month.label}</p></div><MonthSelector monthKey={month.key} /></header>
    {content}
  </>;
}
