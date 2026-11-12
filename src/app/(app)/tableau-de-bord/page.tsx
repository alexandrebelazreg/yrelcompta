import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/ui/metric-card";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { Icon, type IconName } from "@/components/ui/icon";
import { calculateDashboardMetrics, dailyCollectedCents, fixedCostCoveragePercent, resolveDashboardMonth } from "@/lib/dashboard/calculations";
import { fixedCostCoverageMessage } from "@/lib/dashboard/presentation";
import { getDashboardData, getRecurringDraftReviewCount } from "@/lib/dashboard/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { saleChannelLabels } from "@/lib/sales/labels";
import { getPendingDeclarationPeriods } from "@/lib/registers/queries";
import { getTodayDraftCounts } from "@/lib/today/queries";
import { buildTodayTasks, formatTodayLabel, type TodayTask } from "@/lib/today/tasks";
import { getTodayInParis } from "@/lib/utils/date";
import { formatFrenchDate } from "@/lib/utils/format";
import type { BreakEvenUnavailableReason, DashboardMetrics, DashboardMonth, DashboardRecentSale } from "@/types/dashboard";
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


const quickActions: Array<{ href: string; label: string; icon: IconName; primary?: boolean }> = [
  { href: "/ventes/nouvelle", label: "Vente", icon: "plus", primary: true },
  { href: "/depenses/nouvelle", label: "Dépense", icon: "expenses" },
  { href: "/documents", label: "Justificatif", icon: "camera" },
];

/** Encaissé du mois : le chiffre principal, son détail et sa répartition jour par jour. */
function MonthHero({ metrics, month, days, coverage }: { metrics: DashboardMetrics; month: DashboardMonth; days: number[]; coverage: number | null }) {
  const max = Math.max(1, ...days);
  const today = getTodayInParis();
  const todayIndex = today.startsWith(month.key) ? Number(today.slice(8, 10)) - 1 : -1;
  return <section className="today-hero" aria-labelledby="today-hero-label">
    <div className="today-hero-main">
      <div className="info-line"><span id="today-hero-label" className="today-hero-label">Encaissé en {month.label}</span><InfoTip label="Détail des encaissements">Brut encaissé moins remboursements clients : {formatEuroCents(metrics.cash.grossCollectedCents)} encaissés, {formatEuroCents(metrics.cash.customerRefundedCents)} remboursés.</InfoTip></div>
      <strong className="today-hero-value">{formatEuroCents(metrics.cash.revenueCollectedCents)}</strong>
      <span className="today-hero-sub">{formatEuroCents(metrics.cash.grossCollectedCents)} encaissés · {formatEuroCents(metrics.cash.customerRefundedCents)} remboursés</span>
    </div>
    <div className="today-hero-side">
      <div className="today-bars" aria-hidden="true">
        {days.map((cents, index) => <span key={index} className={index === todayIndex ? "is-today" : cents > 0 ? "has-value" : undefined} style={{ height: `${Math.max(4, Math.round((cents / max) * 100))}%` }} />)}
      </div>
      {coverage === null
        ? <p className="today-coverage-empty">{metrics.fixedCostCoverage.unavailableReason === "fixed-costs-not-configured" ? <><Link href="/depenses/recurrences">Renseignez vos charges fixes</Link> pour suivre leur couverture.</> : fixedCostCoverageMessage(metrics.fixedCostCoverage.unavailableReason)}</p>
        : <div className="today-coverage">
            <div><span>Charges fixes du mois couvertes par la marge</span><strong>{coverage} %</strong></div>
            <div className="today-progress" role="progressbar" aria-valuenow={Math.min(coverage, 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Charges fixes couvertes"><span style={{ width: `${Math.min(coverage, 100)}%` }} /></div>
          </div>}
    </div>
  </section>;
}

function TaskList({ tasks }: { tasks: TodayTask[] | null }) {
  return <section className="today-tasks" aria-labelledby="today-tasks-heading">
    <div className="today-section-title"><h2 id="today-tasks-heading">À faire</h2>{tasks && tasks.length > 0 && <span className="today-count">{tasks.length}</span>}</div>
    {tasks === null
      ? <p className="today-panel today-empty">La liste n’a pas pu être chargée. Réessayez dans quelques instants.</p>
      : tasks.length === 0
        ? <div className="today-panel today-empty"><Icon name="check" /><p><strong>Tout est à jour.</strong> Aucune vente, dépense ou déclaration n’attend votre action.</p></div>
        : <ul className="today-panel today-task-list">
            {tasks.map((task) => <li key={task.id} className="today-task">
              <span className={`today-dot today-dot-${task.tone}`} aria-hidden="true" />
              <div><strong>{task.title}</strong><span>{task.detail}</span></div>
              <Link className="button-link today-task-action" href={task.href}>{task.action}</Link>
            </li>)}
          </ul>}
  </section>;
}

function MonthSummary({ metrics, recentSales }: { metrics: DashboardMetrics; recentSales: DashboardRecentSale[] }) {
  const rows = [
    { label: "Commissions", hint: "Suivies à part, jamais en dépense", value: metrics.cash.platformFeesCents },
    { label: "Dépenses professionnelles nettes", hint: "Part pro payée moins remboursements", value: metrics.cash.netExpensesCents },
    { label: "Flux net suivi", hint: "Pas un bénéfice comptable ou fiscal", value: metrics.cash.trackedCashCents },
  ];
  return <aside className="today-summary" aria-label="Ce mois-ci">
    <div className="today-section-title"><h2>Ce mois-ci</h2></div>
    <dl className="today-panel today-summary-list">
      {rows.map((row) => <div key={row.label}><dt><span>{row.label}</span><small>{row.hint}</small></dt><dd>{formatEuroCents(row.value)}</dd></div>)}
    </dl>
    <div className="today-section-title"><h2>Dernières ventes</h2><Link href="/ventes">Tout voir</Link></div>
    {recentSales.length === 0
      ? <p className="today-panel today-empty">Vos dernières ventes apparaîtront ici après leur création.</p>
      : <ul className="today-panel today-sales">
          {recentSales.map((sale) => <li key={sale.id}><Link href={`/ventes/${sale.id}`}><span><strong>{sale.reference}</strong><small>{formatFrenchDate(sale.orderedOn)} · {saleChannelLabels[sale.channel]}</small></span><span className="today-amount">{formatEuroCents(sale.totalCents)}</span></Link></li>)}
        </ul>}
  </aside>;
}

function MonthAnalysis({ metrics, monthKey }: { metrics: DashboardMetrics; monthKey: string }) {
  const profitabilityAvailable = metrics.profitability.completeCount > 0;
  const referenceAvailable = metrics.reference.saleCount > 0;
  const breakEvenReason = metrics.breakEven.unavailableReason
    ? unavailableReasons[metrics.breakEven.unavailableReason]
    : "Calculé à partir de la marge pondérée des 90 derniers jours du mois sélectionné.";

  return <section className="today-analysis" aria-labelledby="analysis-heading">
    <div className="today-analysis-header">
      <div><h2 id="analysis-heading">Analyse du mois</h2><p>Rentabilité, réserve estimée et seuil, pour le mois choisi.</p></div>
      <MonthSelector monthKey={monthKey} />
    </div>
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
      <DashboardSectionHeading id="break-even-heading" title="Charges fixes et seuil de rentabilité" action={<Link className="secondary-link" href="/rentabilite">Voir le détail</Link>} help="Les charges fixes sont annualisées depuis les modèles actifs, fixes et d’exploitation, puis ramenées au mois. Le seuil indique le chiffre d’affaires marchand mensuel nécessaire pour couvrir cette estimation avec la marge historique de référence." />
      <div className="metric-grid">
        <MetricCard label="Charges fixes estimées / mois" value={moneyOrUnavailable(metrics.fixedCosts.monthlyCents)} help="Estimation issue des charges récurrentes actives classées en charges fixes." secondary={metrics.fixedCosts.annualCents === null ? undefined : `${formatEuroCents(metrics.fixedCosts.annualCents)} par an`} action={<Link className="card-link" href="/depenses/recurrences">Gérer les charges fixes</Link>} />
        <MetricCard label="Taux de marge de fabrication de référence — 90 jours" value={referenceAvailable ? percentOrUnavailable(metrics.reference.marginRateBasisPoints) : "Indisponible"} help={`${metrics.reference.saleCount} vente(s) complète(s) pondérée(s) par le chiffre d’affaires marchandises.`} />
        <MetricCard label="Seuil de rentabilité estimé" value={moneyOrUnavailable(metrics.breakEven.monthlyRevenueCents)} help="Seuil de couverture des charges fixes par la marge de fabrication. Il exclut notamment les cotisations sociales, la TVA, l’impôt et les coûts commerciaux non inclus dans la marge produit." secondary={metrics.breakEven.monthlyRevenueCents === null ? breakEvenReason : undefined} />
        <MetricCard label="Écart après couverture des charges fixes" value={moneyOrUnavailable(metrics.fixedCostCoverage.deltaCents)} help={metrics.fixedCostCoverage.deltaCents === null ? undefined : fixedCostCoverageMessage(metrics.fixedCostCoverage.unavailableReason)} secondary={metrics.fixedCostCoverage.deltaCents === null ? fixedCostCoverageMessage(metrics.fixedCostCoverage.unavailableReason) : undefined} />
      </div>
    </section>
  </section>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [{ context }, params] = await Promise.all([getAuthenticatedContext(), searchParams]);
  const month = resolveDashboardMonth(params.mois);
  const firstName = context.profile?.first_name;
  const header = <header className="today-header">
    <div>
      <p className="today-date">{firstName ? `Bonjour ${firstName} · ` : ""}{formatTodayLabel()}</p>
      <h1>Aujourd’hui</h1>
    </div>
    <nav className="today-quick" aria-label="Ajouter">
      {quickActions.map((action) => <Link key={action.href} className={action.primary ? "button-link" : "secondary-link"} href={action.href}><Icon name={action.icon} />{action.label}</Link>)}
    </nav>
  </header>;

  if (!context.business) {
    return <>{header}<EmptyState title="Entreprise non configurée" description="Terminez la configuration de votre entreprise pour afficher ses indicateurs." /></>;
  }
  const businessId = context.business.id;

  const [dashboard, tasks] = await Promise.all([
    getDashboardData(businessId, month).then((source) => ({ source, metrics: calculateDashboardMetrics(source) })).catch(() => null),
    Promise.all([getTodayDraftCounts(businessId), getRecurringDraftReviewCount(businessId), getPendingDeclarationPeriods(businessId)])
      .then(([drafts, recurringDraftCount, pendingDeclarations]) => ({ drafts, recurringDraftCount, pendingDeclarations }))
      .catch(() => null),
  ]);

  if (!dashboard) {
    return <>{header}<div className="dashboard-error" role="alert"><h2>Données indisponibles</h2><p>Le tableau de bord n’a pas pu être chargé. Aucun indicateur partiel n’est affiché. Réessayez dans quelques instants.</p></div></>;
  }

  const todayTasks = tasks === null ? null : buildTodayTasks({
    draftSaleCount: tasks.drafts.draftSaleCount,
    draftExpenseCount: tasks.drafts.draftExpenseCount,
    recurringDraftCount: tasks.recurringDraftCount,
    missingDocumentCount: dashboard.metrics.missingDocumentCount,
    pendingDeclarations: tasks.pendingDeclarations,
  });

  return <>
    {header}
    <MonthHero metrics={dashboard.metrics} month={month} days={dailyCollectedCents(dashboard.source.payments, month)} coverage={fixedCostCoveragePercent(dashboard.metrics)} />
    <div className="today-columns">
      <TaskList tasks={todayTasks} />
      <MonthSummary metrics={dashboard.metrics} recentSales={dashboard.source.recentSales} />
    </div>
    <MonthAnalysis metrics={dashboard.metrics} monthKey={month.key} />
  </>;
}
