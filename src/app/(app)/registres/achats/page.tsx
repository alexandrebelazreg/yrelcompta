import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { expensePaymentMethodLabels, expenseRefundKindLabels } from "@/lib/expenses/labels";
import { resolveRegisterYear } from "@/lib/registers/calculations";
import { getPurchaseRegister } from "@/lib/registers/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";

export default async function PurchaseRegisterPage({ searchParams }: { searchParams: Promise<{ annee?: string | string[] }> }) {
  const [{ context }, params] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const year = resolveRegisterYear(params.annee);
  const data = await getPurchaseRegister(context.business.id, year);
  return <>
    <Link className="back-link" href="/registres">← Registres</Link>
    <header className="page-header"><div><p className="eyebrow">Registre chronologique</p><h1>Registre des achats</h1><p>Une ligne par règlement fournisseur réel, pour l’année {year}.</p></div><div className="header-actions"><form className="year-filter" method="get"><label htmlFor="purchase-year">Année</label><input className="input" id="purchase-year" name="annee" type="number" min="1900" max="9999" defaultValue={year}/><button className="button" type="submit">Afficher</button></form><Link className="secondary-link" href={`/registres/achats/export?annee=${year}`}>Exporter le registre des achats CSV</Link></div></header>
    <section className="register-totals" aria-label="Totaux des achats">
      {data.totals.quarterCents.map((total, index) => <Card key={index}><p>Trimestre {index + 1}</p><strong>{formatEuroCents(total)}</strong></Card>)}
      <Card><p>Total annuel</p><strong>{formatEuroCents(data.totals.annualCents)}</strong></Card>
    </section>
    <p className="dashboard-note">Le montant réglé est affiché en brut. La part professionnelle est une donnée interne YrelCompta et ne constitue pas une déduction fiscale.</p>
    <div className="register-table-wrap"><table className="register-table"><thead><tr><th>Date du règlement</th><th>Référence dépense</th><th>Description</th><th>Mode de règlement</th><th>Référence fournisseur / justificatif</th><th>Référence du paiement</th><th>Montant réglé</th><th>Part professionnelle suivie</th><th>Enregistré le</th></tr></thead><tbody>
      {data.entries.map((entry) => <tr key={entry.id}><td>{formatFrenchDate(entry.paidOn)}</td><td>{entry.expenseReference}</td><td>{entry.description}</td><td>{expensePaymentMethodLabels[entry.method]}</td><td>{entry.supplierReference ?? "—"}</td><td>{entry.paymentReference ?? "—"}</td><td><strong>{formatEuroCents(entry.amountCents)}</strong></td><td>{formatEuroCents(entry.businessAmountCents)}</td><td>{formatFrenchDate(entry.createdAt)}</td></tr>)}
      {data.entries.length === 0 && <tr><td colSpan={9} className="register-empty">Aucun règlement fournisseur enregistré pour cette année.</td></tr>}
    </tbody></table></div>
    <section className="register-secondary"><div className="section-heading"><div><p className="eyebrow">Réconciliation séparée</p><h2>Avoirs et remboursements fournisseurs</h2></div></div>
      <p>Ces opérations restent séparées du montant brut du registre des achats et ne sont jamais soustraites silencieusement.</p>
      <div className="register-table-wrap"><table className="register-table"><thead><tr><th>Date</th><th>Référence dépense</th><th>Montant</th><th>Type</th><th>Motif</th><th>Référence externe</th></tr></thead><tbody>
        {data.refunds.map((refund) => <tr key={refund.id}><td>{formatFrenchDate(refund.receivedOn)}</td><td>{refund.expenseReference}</td><td>{formatEuroCents(refund.amountCents)}</td><td>{expenseRefundKindLabels[refund.kind]}</td><td>{refund.reason}</td><td>{refund.externalReference ?? "—"}</td></tr>)}
        {data.refunds.length === 0 && <tr><td colSpan={6} className="register-empty">Aucun avoir ou remboursement fournisseur pour cette année.</td></tr>}
      </tbody></table></div>
    </section>
  </>;
}
