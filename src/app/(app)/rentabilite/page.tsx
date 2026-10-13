import Link from "next/link";
import { InfoTip } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/ui/metric-card";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { recurrenceFrequencyLabels } from "@/lib/expenses/labels";
import { formatBasisPoints } from "@/lib/fiscal-social/presentation";
import { calculateProfitabilityPlan, type ProfitabilityUnavailableReason } from "@/lib/profitability/calculations";
import { getProfitabilityData } from "@/lib/profitability/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";

const unavailableMessages: Record<ProfitabilityUnavailableReason, string> = {
  "no-costs": "Ajoutez vos abonnements, charges fixes ou achats de matériel pour calculer votre seuil.",
  "no-margin-reference": "Renseignez le prix de vente et la recette de vos produits pour estimer votre marge.",
  "non-positive-margin": "Votre marge de référence est nulle ou négative : aucun volume de ventes ne couvre les charges.",
  "levy-exceeds-margin": "Les cotisations estimées dépassent votre taux de marge : revoyez vos prix ou vos coûts.",
};

export default async function ProfitabilityPage() {
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const data = await getProfitabilityData(context.business.id);
  const plan = calculateProfitabilityPlan(data);
  const target = plan.breakEvenAfterLevyCents ?? plan.breakEvenRevenueCents;
  const referenceLabel = data.reference?.source === "sales"
    ? `${data.reference.count} vente(s) complète(s) des 90 derniers jours`
    : data.reference ? `moyenne des ${data.reference.count} produit(s) actif(s) du catalogue` : "aucune référence";

  return <>
    <header className="page-header"><div className="info-line"><h1>Rentabilité</h1><InfoTip label="À propos de la rentabilité">Estimation interne pour piloter votre activité. Ce n’est ni un résultat comptable, ni un résultat fiscal.</InfoTip></div><div className="header-actions"><Link className="secondary-link" href="/depenses/recurrences">Ajouter une charge fixe</Link><Link className="button-link" href="/depenses/nouvelle">Ajouter du matériel</Link></div></header>

    <section className="dashboard-section" aria-label="Ce qu’il faut couvrir chaque mois">
      <div className="metric-grid">
        <MetricCard label="Marge à dégager chaque mois" value={formatEuroCents(plan.monthlyToCoverCents)} help="Charges fixes mensualisées et matériel lissé sur 12 mois : c’est la marge que vos ventes doivent produire pour être à l’équilibre." secondary={`${formatEuroCents(plan.recurringMonthlyCents)} de charges fixes + ${formatEuroCents(plan.equipmentMonthlyCents)} de matériel`} />
        <MetricCard label="Taux de marge de référence" value={plan.marginRateBasisPoints === null ? "Indisponible" : formatBasisPoints(plan.marginRateBasisPoints)} help="Marge de fabrication divisée par le prix de vente, avant commissions, cotisations et fiscalité." secondary={referenceLabel} />
        <MetricCard label="Chiffre d’affaires mensuel nécessaire" value={target === null ? "Indisponible" : formatEuroCents(target)} help={plan.breakEvenAfterLevyCents !== null && data.levyRateBasisPoints !== null ? <>Inclut les cotisations sociales, la CFP et le versement libératoire éventuel estimés à {formatBasisPoints(data.levyRateBasisPoints)} du chiffre d’affaires. Hors commissions, TVA et frais d’expédition.</> : "Hors cotisations sociales (profil fiscal non configuré), commissions, TVA et frais d’expédition."} secondary={target === null && plan.unavailableReason ? unavailableMessages[plan.unavailableReason] : plan.breakEvenAfterLevyCents !== null && plan.breakEvenRevenueCents !== null ? `${formatEuroCents(plan.breakEvenRevenueCents)} avant cotisations` : undefined} action={plan.breakEvenAfterLevyCents === null && data.levyRateBasisPoints === null ? <Link className="card-link" href="/parametres/fiscalite">Configurer les cotisations</Link> : undefined} />
        <MetricCard label="Bijoux à vendre par mois" value={plan.unitsPerMonth === null ? "Indisponible" : `≈ ${plan.unitsPerMonth}`} help="Chiffre d’affaires nécessaire divisé par le prix de vente moyen de vos produits actifs." secondary={target === null ? undefined : `${formatEuroCents(target * 12)} par an`} />
      </div>
      {plan.unavailableReason === "levy-exceeds-margin" && <p className="form-message">{unavailableMessages["levy-exceeds-margin"]}</p>}
    </section>

    <section className="dashboard-section" aria-labelledby="fixed-heading">
      <div className="section-heading"><div className="info-line"><h2 id="fixed-heading">Charges fixes et abonnements</h2><InfoTip label="Charges comptées">Modèles de charges récurrentes actifs, classés « fixe » et « exploitation ». Les matières premières, emballages et cotisations sont exclus car déjà pris en compte ailleurs.</InfoTip></div><Link className="secondary-link" href="/depenses/recurrences">Gérer</Link></div>
      {plan.chargeLines.length === 0 ? <p className="history-empty">Aucune charge fixe. Ajoutez vos abonnements (site, logiciel, assurance, téléphone…) dans les charges récurrentes.</p> : <div className="register-table-wrap compact-table-wrap"><table className="register-table compact-table profitability-table"><thead><tr><th>Charge</th><th>Fréquence</th><th>Montant pro</th><th>Par mois</th></tr></thead><tbody>{plan.chargeLines.map((line) => <tr key={line.id}><td className="compact-primary-cell profitability-main">{line.description}</td><td>{recurrenceFrequencyLabels[line.frequency]}</td><td className="compact-amount">{formatEuroCents(line.professionalAmountCents)}</td><td className="compact-amount profitability-amount">{formatEuroCents(line.monthlyCents)}</td><td className="compact-mobile-context">{recurrenceFrequencyLabels[line.frequency]} · {formatEuroCents(line.professionalAmountCents)}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="dashboard-section" aria-labelledby="equipment-heading">
      <div className="section-heading"><div className="info-line"><h2 id="equipment-heading">Matériel et frais généraux</h2><InfoTip label="Matériel compté">Dépenses validées de catégorie « Matériel » ou de nature « Investissement » depuis le {formatFrenchDate(data.equipmentSince)}, part professionnelle, lissées sur 12 mois.</InfoTip></div><Link className="secondary-link" href="/depenses/nouvelle">Ajouter</Link></div>
      {data.equipment.length === 0 ? <p className="history-empty">Aucun achat de matériel sur les 12 derniers mois.</p> : <div className="register-table-wrap compact-table-wrap"><table className="register-table compact-table profitability-table"><thead><tr><th>Achat</th><th>Date</th><th>Montant pro</th></tr></thead><tbody>{data.equipment.map((expense) => <tr key={expense.id}><td className="compact-primary-cell profitability-main"><Link className="compact-primary-link" href={`/depenses/${expense.id}`}>{expense.description}</Link></td><td>{formatFrenchDate(expense.purchasedOn)}</td><td className="compact-amount profitability-amount">{formatEuroCents(expense.businessAmountCents)}</td><td className="compact-mobile-context">{formatFrenchDate(expense.purchasedOn)}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
