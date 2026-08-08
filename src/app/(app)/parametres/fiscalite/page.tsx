import Link from "next/link";
import { InfoTip } from "@/components/ui/info-tip";
import { SubmitButton } from "@/components/ui/submit-button";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { calculateAcreEndDate, roundRateUpToIncrement } from "@/lib/fiscal-social/calculations";
import { createFiscalProfileAction } from "@/lib/fiscal-social/actions";
import { formatBasisPoints } from "@/lib/fiscal-social/presentation";
import { getFiscalSettingsPageData } from "@/lib/fiscal-social/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";

function nextEffectiveDate(lastEffectiveFrom: string): string {
  return `${Number(lastEffectiveFrom.slice(0, 4)) + 1}-01-01`;
}

export default async function FiscalSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ context, userId }, query] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business || !userId) return null;
  const data = await getFiscalSettingsPageData(context.business.id, userId);
  const latest = data.profiles.at(-1) ?? null;
  const effectiveFrom = latest ? nextEffectiveDate(latest.effectiveFrom) : data.activityStartedOn;
  const message = query.message === "version-enregistree" ? "Nouvelle version fiscale enregistrée pour les calculs futurs." : null;
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const active = data.activeProfile;
  const rule = data.activeRule;
  const acreEnd = active?.hasAcre && data.activeAcreRule && data.activityStartedOn
    ? calculateAcreEndDate(data.activityStartedOn, data.activeAcreRule.durationQuartersAfterStart)
    : null;
  const theoreticalAcreRate = active?.hasAcre && data.activeAcreRule && rule
    ? roundRateUpToIncrement(rule.socialContributionBasisPoints, data.activeAcreRule.paidFractionBasisPoints, data.activeAcreRule.rateRoundingIncrementBasisPoints)
    : null;

  return <>
    <Link className="back-link" href="/parametres">← Paramètres</Link>
    <header className="page-header"><div className="info-line"><h1>Paramètres fiscaux et sociaux</h1><InfoTip label="À propos des paramètres fiscaux et sociaux">Configurez les choix de l’entreprise sans saisir ni dupliquer les taux légaux.</InfoTip></div></header>
    {message && <p className="form-message success" role="status">{message}</p>}{error && <p className="form-message" role="alert">{error}</p>}
    <div className="fiscal-warnings">
      <strong>Estimation interne de trésorerie.</strong> YrelCompta ne transmet aucune déclaration.
      <span>Hors CFE · Hors impôt sur le revenu au barème progressif · TVA non calculée dans cette version.</span>
    </div>

    <section className="card fiscal-settings-section"><h2>Version fiscale de l’entreprise</h2>
      {active ? <dl className="detail-list">
        <div><dt>Date d’effet</dt><dd>{formatFrenchDate(active.effectiveFrom)}</dd></div>
        <div><dt>CFP</dt><dd>{active.cfpCategory === "commercial" ? "Activité commerciale" : "Activité artisanale"}</dd></div>
        <div><dt>ACRE déclarée</dt><dd>{active.hasAcre ? "Oui" : "Non"}</dd></div>
        <div><dt>Versement libératoire</dt><dd>{active.versementLiberatoire ? "Activé" : "Non activé"}</dd></div>
      </dl> : <p>Aucune version fiscale n’est encore configurée.</p>}
    </section>

    <section className="card fiscal-settings-section"><div className="info-line"><h2>Règle applicable aujourd’hui</h2><InfoTip label="À propos des plafonds affichés">Ces plafonds sont informatifs. Cette version ne prorate pas les seuils et n’automatise aucun changement de régime micro ou de TVA.</InfoTip></div>
      {rule ? <><dl className="detail-list">
        <div><dt>Cotisations micro-sociales normales</dt><dd>{formatBasisPoints(rule.socialContributionBasisPoints)}</dd></div>
        <div><dt>CFP applicable au profil</dt><dd>{active ? formatBasisPoints(active.cfpCategory === "commercial" ? rule.cfpCommercialBasisPoints : rule.cfpArtisanBasisPoints) : "Profil requis"}</dd></div>
        <div><dt>Versement libératoire</dt><dd>{active?.versementLiberatoire ? formatBasisPoints(rule.versementLiberatoireBasisPoints) : "Non activé"}</dd></div>
        <div><dt>Abattement micro-BIC vente</dt><dd>{formatBasisPoints(rule.incomeTaxAbatementBasisPoints)}</dd></div>
        <div><dt>Plafond du régime micro vente</dt><dd>{formatEuroCents(rule.microTurnoverCeilingCents)}</dd></div>
        <div><dt>Franchise TVA — seuil de base</dt><dd>{formatEuroCents(rule.vatFranchiseBaseCeilingCents)}</dd></div>
        <div><dt>Franchise TVA — seuil majoré</dt><dd>{formatEuroCents(rule.vatFranchiseToleranceCeilingCents)}</dd></div>
        <div><dt>Source contrôlée</dt><dd>{rule.sourceLabel} · {formatFrenchDate(rule.sourceCheckedOn)}</dd></div>
      </dl>
      {active?.hasAcre && <><p className="dashboard-note">ACRE : {data.activeAcreRule ? `${formatBasisPoints(data.activeAcreRule.paidFractionBasisPoints)} du taux normal, soit un taux théorique de ${theoreticalAcreRate === null ? "indisponible" : formatBasisPoints(theoreticalAcreRate)}, arrondi par pas de ${formatBasisPoints(data.activeAcreRule.rateRoundingIncrementBasisPoints)}. Fin théorique : ${acreEnd ? formatFrenchDate(acreEnd) : "indisponible"}.` : "règle non disponible"}</p><p className="declaration-warning">Le taux ACRE est affiché à titre de référence. La réserve monétaire pendant l’ACRE reste indisponible tant que son plafond légal n’est pas modélisé.</p></>}</> : <p>Règle non disponible pour la date courante.</p>}
    </section>

    <section className="card fiscal-settings-section"><div className="info-line"><h2>{latest ? "Créer une version suivante" : "Créer la première version"}</h2><InfoTip label="À propos du versionnement fiscal">Chaque nouvelle configuration s’ajoute à l’historique sans modifier les versions déjà utilisées.</InfoTip></div>
      {!data.activityStartedOn ? <p>Renseignez d’abord la date légale de début d’activité dans <Link href="/registres/declarations">Déclarations</Link>.</p>
        : !data.isOwner ? <p>Seul le propriétaire de l’entreprise peut créer une version fiscale.</p>
        : effectiveFrom && <form action={createFiscalProfileAction} className="form-stack">
          <div className="form-grid">
            <div className="field"><label htmlFor="effectiveFrom">Date d’effet</label><input className="input" id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={effectiveFrom} readOnly={!latest} required/><small>{latest ? "Une version suivante doit commencer un 1er janvier et ne peut pas modifier une déclaration existante." : "La première version commence exactement à la date de début d’activité."}</small></div>
            <div className="field"><label htmlFor="cfpCategory">Catégorie CFP</label><select className="input" id="cfpCategory" name="cfpCategory" defaultValue={latest?.cfpCategory ?? "commercial"}><option value="commercial">Activité commerciale</option><option value="artisan">Activité artisanale</option></select></div>
            <div className="field"><label htmlFor="hasAcre">ACRE</label><select className="input" id="hasAcre" name="hasAcre" defaultValue={(latest?.hasAcre ?? data.legacyHasAcre) ? "yes" : "no"}><option value="no">Non</option><option value="yes">Oui</option></select></div>
            <div className="field"><label htmlFor="versementLiberatoire">Versement libératoire</label><select className="input" id="versementLiberatoire" name="versementLiberatoire" defaultValue={latest?.versementLiberatoire ? "yes" : "no"}><option value="no">Non</option><option value="yes">Oui</option></select></div>
          </div>
          <SubmitButton>Enregistrer cette version</SubmitButton>
        </form>}
    </section>

    <section className="fiscal-history"><div className="section-heading"><h2>Historique des versions</h2></div>
      {data.profiles.length === 0 ? <p className="history-empty">Aucune version enregistrée.</p> : <ol>{data.profiles.toReversed().map((profile) => <li className="card" key={profile.id}><strong>À compter du {formatFrenchDate(profile.effectiveFrom)}</strong><span>CFP {profile.cfpCategory === "commercial" ? "commerciale" : "artisanale"} · ACRE {profile.hasAcre ? "oui" : "non"} · Versement libératoire {profile.versementLiberatoire ? "oui" : "non"}</span></li>)}</ol>}
    </section>
  </>;
}
