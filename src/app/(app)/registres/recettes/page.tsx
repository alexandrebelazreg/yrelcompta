import Link from "next/link";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { resolveRegisterYear } from "@/lib/registers/calculations";
import { getRevenueRegister } from "@/lib/registers/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { paymentMethodLabels, refundKindLabels, saleChannelLabels } from "@/lib/sales/labels";
import { formatFrenchDate } from "@/lib/utils/format";

export default async function RevenueRegisterPage({ searchParams }: { searchParams: Promise<{ annee?: string | string[] }> }) {
  const [{ context }, params] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const year = resolveRegisterYear(params.annee);
  const data = await getRevenueRegister(context.business.id, year);
  return <>
    <Link className="back-link" href="/registres">← Registres</Link>
    <header className="page-header"><div className="info-line"><h1>Livre des recettes</h1><InfoTip label="À propos du livre des recettes"><p>Une ligne par encaissement réel, pour l’année {year}.</p><p>Le montant réglementaire est l’encaissement brut. Les commissions sont informatives et ne réduisent jamais la recette.</p></InfoTip></div><div className="header-actions"><form className="year-filter" method="get"><label htmlFor="revenue-year">Année</label><input className="input" id="revenue-year" name="annee" type="number" min="1900" max="9999" defaultValue={year}/><button className="button" type="submit">Afficher</button></form><Link className="secondary-link" href={`/registres/recettes/export?annee=${year}`}>Exporter le livre des recettes CSV</Link></div></header>
    <section className="register-totals" aria-label="Totaux des recettes">
      {data.totals.quarterCents.map((total, index) => <Card key={index}><p>Trimestre {index + 1}</p><strong>{formatEuroCents(total)}</strong></Card>)}
      <Card><p>Total annuel</p><strong>{formatEuroCents(data.totals.annualCents)}</strong></Card>
    </section>
    <div className="register-table-wrap"><table className="register-table"><thead><tr><th>Date d’encaissement</th><th>Origine</th><th>Référence vente</th><th>Canal</th><th>Mode de règlement</th><th>Référence paiement</th><th>Montant encaissé</th><th>Commission informative</th><th>Enregistré le</th></tr></thead><tbody>
      {data.entries.map((entry) => <tr className={entry.method === "cash" ? "cash-row" : undefined} key={entry.id}><td>{formatFrenchDate(entry.receivedOn)}</td><td>{entry.origin}</td><td>{entry.saleReference}</td><td>{saleChannelLabels[entry.channel]}</td><td>{paymentMethodLabels[entry.method]}{entry.method === "cash" && <span className="cash-badge">Espèces</span>}</td><td>{entry.paymentReference ?? "—"}</td><td><strong>{formatEuroCents(entry.grossAmountCents)}</strong></td><td>{formatEuroCents(entry.platformFeeCents)}</td><td>{formatFrenchDate(entry.createdAt)}</td></tr>)}
      {data.entries.length === 0 && <tr><td colSpan={9} className="register-empty">Aucun encaissement enregistré pour cette année.</td></tr>}
    </tbody></table></div>
    <section className="register-secondary"><div className="section-heading"><div className="info-line"><h2>Remboursements clients</h2><InfoTip label="À propos du traitement des remboursements clients">Ces remboursements sont présentés séparément et ne sont pas déduits automatiquement du livre des recettes ou du montant déclaratif.</InfoTip></div></div>
      <div className="register-table-wrap"><table className="register-table"><thead><tr><th>Date</th><th>Référence vente</th><th>Paiement concerné</th><th>Montant</th><th>Motif</th></tr></thead><tbody>
        {data.refunds.map((refund) => <tr key={refund.id}><td>{formatFrenchDate(refund.refundedOn)}</td><td>{refund.saleReference}</td><td>{refund.paymentReference ?? "—"}</td><td>{formatEuroCents(refund.amountCents)}</td><td>{refundKindLabels[refund.kind]} · {refund.reason}</td></tr>)}
        {data.refunds.length === 0 && <tr><td colSpan={5} className="register-empty">Aucun remboursement client pour cette année.</td></tr>}
      </tbody></table></div>
    </section>
  </>;
}
