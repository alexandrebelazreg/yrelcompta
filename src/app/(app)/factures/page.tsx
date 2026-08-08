import Link from "next/link";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { resolveRegisterYear } from "@/lib/registers/calculations";
import { billingCommercialStateLabels, billingDocumentKindLabels } from "@/lib/invoicing/labels";
import { listBillingDocuments } from "@/lib/invoicing/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";
import type { BillingDocumentKind } from "@/types/invoicing";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ context }, query] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const year = resolveRegisterYear(query.annee);
  const kind = query.type === "invoice" || query.type === "credit_note" ? query.type as BillingDocumentKind : undefined;
  const search = typeof query.recherche === "string" ? query.recherche : undefined;
  const documents = await listBillingDocuments(context.business.id, { year, kind, search });
  return <>
    <header className="page-header"><div className="info-line"><h1>Factures et avoirs</h1><InfoTip label="Informations sur les documents et la facturation électronique"><p>Documents immuables générés depuis les ventes validées.</p><p>Le PDF généré par YrelCompta n’est pas, à lui seul, une facture électronique au sens de la réforme française. La transmission B2B réglementaire devra passer par une plateforme agréée selon le calendrier applicable.</p></InfoTip></div></header>
    <form className="sales-filters"><div className="field"><label htmlFor="invoice-year">Année</label><input className="input" id="invoice-year" name="annee" type="number" min="2000" max="9999" defaultValue={year}/></div><div className="field"><label htmlFor="invoice-kind">Type</label><select className="input" id="invoice-kind" name="type" defaultValue={kind ?? ""}><option value="">Tous</option><option value="invoice">Factures</option><option value="credit_note">Avoirs</option></select></div><div className="field filter-search"><label htmlFor="invoice-search">Numéro, cliente ou vente</label><input className="input" id="invoice-search" name="recherche" defaultValue={search}/></div><button className="secondary-link">Filtrer</button></form>
    {documents.length === 0 ? <div className="empty-state"><h2>Aucun document client</h2><p>Une facture peut être créée depuis une vente validée.</p></div> : <div className="register-table-wrap"><table className="register-table"><thead><tr><th>Numéro</th><th>Type</th><th>Date émission</th><th>Date vente/livraison</th><th>Cliente</th><th>Référence vente</th><th>Total</th><th>État commercial</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td><Link href={`/factures/${document.id}`}><strong>{document.number}</strong></Link></td><td>{billingDocumentKindLabels[document.kind]}</td><td>{formatFrenchDate(document.issuedOn)}</td><td>{formatFrenchDate(document.supplyOn)}</td><td>{document.buyerName}</td><td>{document.saleReference}</td><td>{document.kind === "credit_note" ? "− " : ""}{formatEuroCents(document.totalInclTaxCents)}</td><td>{billingCommercialStateLabels[document.commercialState]}</td></tr>)}</tbody></table></div>}
  </>;
}
