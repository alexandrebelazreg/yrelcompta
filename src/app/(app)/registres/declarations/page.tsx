import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { getAuthenticatedContext } from "@/lib/auth/context";
import {
  recordTurnoverDeclarationAction,
  reviseTurnoverDeclarationAction,
  setActivityStartedOnAction,
} from "@/lib/registers/actions";
import { declarationSubmittedOnMinimum, resolveRegisterYear, turnoverDifference } from "@/lib/registers/calculations";
import { calculationStatusMessages, declarationSuccessMessage, declarationUiStatusLabels } from "@/lib/registers/presentation";
import { getDeclarationsPageData } from "@/lib/registers/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { getTodayInParis } from "@/lib/utils/date";
import { formatFrenchDate } from "@/lib/utils/format";
import type { DeclarationPeriodItem } from "@/types/registers";

function moneyInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

function DeclarationForm({ period, year, revision, today }: { period: DeclarationPeriodItem; year: number; revision: boolean; today: string }) {
  const action = revision ? reviseTurnoverDeclarationAction : recordTurnoverDeclarationAction;
  const suggested = revision ? period.latestDeclaration?.declaredTurnoverCents ?? 0 : period.suggestedTurnoverCents;
  return <form action={action} className="declaration-form form-stack">
    <input type="hidden" name="periodStart" value={period.periodStart}/><input type="hidden" name="periodEnd" value={period.periodEnd}/><input type="hidden" name="year" value={year}/>
    <div className="form-grid"><div className="field"><label htmlFor={`${revision ? "revision" : "declaration"}-${period.periodStart}-amount`}>Montant effectivement déclaré</label><input className="input" id={`${revision ? "revision" : "declaration"}-${period.periodStart}-amount`} name="declaredTurnover" inputMode="decimal" defaultValue={suggested === null ? "" : moneyInput(suggested)} required/></div><div className="field"><label htmlFor={`${revision ? "revision" : "declaration"}-${period.periodStart}-date`}>Date de déclaration</label><input className="input" id={`${revision ? "revision" : "declaration"}-${period.periodStart}-date`} name="submittedOn" type="date" defaultValue={today} min={declarationSubmittedOnMinimum(period.periodEnd)} max={today} required/></div><div className="field"><label htmlFor={`${revision ? "revision" : "declaration"}-${period.periodStart}-reference`}>Référence Urssaf facultative</label><input className="input" id={`${revision ? "revision" : "declaration"}-${period.periodStart}-reference`} name="externalReference" maxLength={200}/></div><div className="field"><label htmlFor={`${revision ? "revision" : "declaration"}-${period.periodStart}-reason`}>{revision ? "Motif de correction" : "Motif d’écart si requis"}</label><textarea className="input" id={`${revision ? "revision" : "declaration"}-${period.periodStart}-reason`} name="adjustmentReason" maxLength={1000} required={revision || period.suggestedTurnoverCents === null}/></div></div>
    <p className="declaration-warning">Cette action n’envoie rien à l’Urssaf. Elle enregistre uniquement dans YrelCompta ce que vous avez déclaré.</p>
    <SubmitButton>{revision ? "Enregistrer une correction" : "Enregistrer comme déclarée"}</SubmitButton>
  </form>;
}

export default async function DeclarationsPage({ searchParams }: { searchParams: Promise<{ annee?: string | string[]; message?: string | string[]; erreur?: string | string[] }> }) {
  const [{ context }, params] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const year = resolveRegisterYear(params.annee);
  const today = getTodayInParis();
  const data = await getDeclarationsPageData(context.business.id, year);
  const message = declarationSuccessMessage(params.message);
  const error = typeof params.erreur === "string" ? params.erreur : null;
  return <>
    <Link className="back-link" href="/registres">← Registres</Link>
    <header className="page-header"><div><p className="eyebrow">Suivi dans YrelCompta</p><h1>Déclarations de chiffre d’affaires</h1><p>Préparez les périodes et conservez chaque révision, sans transmission automatique à l’Urssaf.</p></div><form className="year-filter" method="get"><label htmlFor="declaration-year">Année</label><input className="input" id="declaration-year" name="annee" type="number" min="1900" max="9999" defaultValue={year}/><button className="button" type="submit">Afficher</button></form></header>
    {message && <p className="form-message success">{message}</p>}{error && <p className="form-message" role="alert">{error}</p>}
    <section className="declaration-settings card"><div><p className="eyebrow">Configuration</p><h2>Paramètres déclaratifs</h2></div><dl className="detail-list"><div><dt>Périodicité configurée</dt><dd>{data.settings.declarationPeriod === "monthly" ? "Mensuelle" : "Trimestrielle"}</dd></div><div><dt>Régime de TVA</dt><dd>{data.settings.vatRegime === "franchise" ? "Franchise en base" : "Assujettie"}</dd></div><div><dt>Date de début d’activité</dt><dd>{data.settings.activityStartedOn ? formatFrenchDate(data.settings.activityStartedOn) : "Non renseignée"}</dd></div></dl>
      <p className="dashboard-note">Cette périodicité doit correspondre à celle enregistrée auprès de l’Urssaf.</p>
      <form action={setActivityStartedOnAction} className="activity-date-form"><div className="field"><label htmlFor="activity-started-on">Date légale de début d’activité</label><input className="input" id="activity-started-on" name="activityStartedOn" type="date" max={today} defaultValue={data.settings.activityStartedOn ?? ""} required/></div><SubmitButton>{data.settings.activityStartedOn ? "Corriger la date" : "Enregistrer la date"}</SubmitButton></form>
      {data.settings.activityStartedOn && <small>Cette date ne pourra plus être modifiée après l’enregistrement d’une déclaration.</small>}
    </section>
    {data.settings.activityStartedOn === null ? <div className="empty-state"><span className="empty-state-icon">◷</span><h2>Calendrier indisponible</h2><p>Renseignez votre date de début d’activité pour générer le calendrier des déclarations.</p></div> : <>
      <section className="register-totals declaration-totals" aria-label="Cumuls annuels"><Card><p>Encaissements bruts YrelCompta</p><strong>{formatEuroCents(data.annualGrossReceiptsCents)}</strong></Card><Card><p>Remboursements clients suivis</p><strong>{formatEuroCents(data.annualCustomerRefundsCents)}</strong></Card><Card><p>Total des montants déclarés enregistrés</p><strong>{formatEuroCents(data.annualDeclaredCents)}</strong><small>Dernière révision de chaque période</small></Card></section>
      <p className="dashboard-note">Le chiffre d’affaires doit également être reporté dans la déclaration annuelle de revenus. YrelCompta ne calcule pas ici l’impôt ni les cases fiscales à utiliser.</p>
      <section className="declaration-periods"><div className="section-heading"><div><p className="eyebrow">Calendrier {year}</p><h2>Périodes et échéances théoriques</h2></div></div>
        {data.periods.map((period) => {
          const latest = period.latestDeclaration;
          const difference = latest ? turnoverDifference(latest.suggestedTurnoverCents, latest.declaredTurnoverCents) : null;
          return <article className="declaration-period card" key={period.periodStart}><header><div><h3>Du {formatFrenchDate(period.periodStart)} au {formatFrenchDate(period.periodEnd)}</h3><p>Échéance théorique : {formatFrenchDate(period.dueOn)}</p></div><span className={`declaration-status declaration-status-${period.uiStatus}`}>{declarationUiStatusLabels[period.uiStatus]}</span></header>
            <dl className="declaration-metrics"><div><dt>Encaissements bruts</dt><dd>{formatEuroCents(period.grossReceiptsCents)}</dd></div><div><dt>Remboursements clients</dt><dd>{formatEuroCents(period.customerRefundsCents)}</dd></div><div><dt>Montant proposé YrelCompta</dt><dd>{period.suggestedTurnoverCents === null ? "Indisponible" : formatEuroCents(period.suggestedTurnoverCents)}</dd></div><div><dt>Montant déclaré</dt><dd>{latest ? formatEuroCents(latest.declaredTurnoverCents) : "Non enregistré"}</dd></div><div><dt>Écart</dt><dd>{difference === null ? "Indisponible" : formatEuroCents(difference)}</dd></div><div><dt>Dernière révision</dt><dd>{latest ? `Révision ${latest.revisionNo}` : "—"}</dd></div></dl>
            <p className={`calculation-message calculation-message-${period.calculationStatus}`}>{calculationStatusMessages[period.calculationStatus]}</p>
            {!latest && period.uiStatus !== "upcoming" && <details className="action-panel"><summary className="button">Enregistrer comme déclarée</summary><DeclarationForm period={period} year={year} revision={false} today={today}/></details>}
            {latest && <><details className="action-panel"><summary className="secondary-link">Enregistrer une correction</summary><DeclarationForm period={period} year={year} revision today={today}/></details><details className="revision-history"><summary>Historique immuable — {period.revisions.length} révision(s)</summary><ol>{period.revisions.map((revision) => <li key={revision.id}><strong>Révision {revision.revisionNo} — {formatEuroCents(revision.declaredTurnoverCents)}</strong><span>Marquée comme déclarée le {formatFrenchDate(revision.submittedOn)} · enregistrée dans YrelCompta le {formatFrenchDate(revision.createdAt)}</span>{revision.adjustmentReason && <span>Motif : {revision.adjustmentReason}</span>}{revision.externalReference && <span>Référence : {revision.externalReference}</span>}</li>)}</ol></details></>}
          </article>;
        })}
        {data.periods.length === 0 && <p className="history-empty">Aucune période déclarative ne se termine pendant cette année.</p>}
      </section>
    </>}
  </>;
}
