import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/ui/submit-button";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { issueInvoiceAction } from "@/lib/invoicing/actions";
import { billingOperationCategoryLabels } from "@/lib/invoicing/labels";
import { getInvoiceCreationData } from "@/lib/invoicing/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { getTodayInParis } from "@/lib/utils/date";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ context }, query] = await Promise.all([getAuthenticatedContext(), searchParams]);
  if (!context.business) return null;
  const saleId = typeof query.vente === "string" ? query.vente : "";
  if (!saleId) notFound();
  const data = await getInvoiceCreationData(context.business.id, saleId);
  if (!data.sale) notFound();
  const error = typeof query.erreur === "string" ? query.erreur : null;
  const today = getTodayInParis();
  return <>
    <Link className="back-link" href={`/ventes/${data.sale.id}`}>← Vente {data.sale.reference}</Link>
    <header className="page-header"><div><p className="eyebrow">Émission immuable</p><h1>Créer une facture</h1><p>Numéro : attribué lors de l’émission.</p></div></header>
    {error && <p className="form-message" role="alert">{error}</p>}
    {data.existing && <p className="form-message">Une facture existe déjà : <Link href={`/factures/${data.existing.id}`}>{data.existing.number}</Link>.</p>}
    {data.sale.status === "draft" && <p className="form-message">Validez la vente avant d’émettre une facture.</p>}
    {data.sale.status === "cancelled" && <p className="form-message">Une vente annulée ne peut pas recevoir de nouvelle facture.</p>}
    {!data.settings && <p className="form-message">Complétez d’abord les <Link href="/parametres/facturation">paramètres de facturation</Link>.</p>}
    {data.vatRegime === "liable" && <p className="form-message">Facturation automatique indisponible : YrelCompta ne ventile pas encore la TVA. Aucune facture ne sera générée tant que cette ventilation n’est pas implémentée.</p>}
    <section className="card invoice-preview"><div className="section-heading"><div><p className="eyebrow">Aperçu des sources</p><h2>Vente {data.sale.reference}</h2></div><strong>{formatEuroCents(data.sale.total_cents)}</strong></div>{data.sale.sale_items.map((item) => <div className="item-detail" key={item.id}><span>{item.description} · {item.quantity} × {formatEuroCents(item.unit_price_cents)}</span><strong>{formatEuroCents(item.line_total_cents)}</strong></div>)}<dl className="detail-list totals-list"><div><dt>Sous-total</dt><dd>{formatEuroCents(data.sale.subtotal_cents)}</dd></div><div><dt>Livraison</dt><dd>{formatEuroCents(data.sale.shipping_cents)}</dd></div><div><dt>Remise</dt><dd>− {formatEuroCents(data.sale.discount_cents)}</dd></div><div><dt>Total</dt><dd>{formatEuroCents(data.sale.total_cents)}</dd></div></dl>{data.settings && <><h3>Vendeur</h3><p>{data.settings.issuerLegalName}<br/>{data.settings.issuerAddress}<br/>SIRET {data.settings.issuerSiret}</p><p>{data.settings.vatExemptionMention}</p><h3>Conditions B2B configurées</h3><p>{[data.settings.defaultPaymentTerms, data.settings.defaultEarlyPaymentDiscountTerms, data.settings.defaultLatePenaltyTerms, data.settings.defaultRecoveryIndemnityText].filter(Boolean).join(" · ") || "À compléter pour une facture professionnelle."}</p></>}</section>
    {data.sale.status === "validated" && !data.existing && data.settings && data.vatRegime === "franchise" && <form action={issueInvoiceAction} className="card form-stack invoice-form"><input type="hidden" name="saleId" value={data.sale.id}/><div className="form-grid"><div className="field"><label htmlFor="supplyOn">Date de vente / livraison</label><input className="input" id="supplyOn" name="supplyOn" type="date" defaultValue={data.sale.ordered_on} max={today} required/></div><div className="field"><label htmlFor="operationCategory">Type d’opération</label><select className="input" id="operationCategory" name="operationCategory" defaultValue="goods" required>{Object.entries(billingOperationCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="buyerKind">Type de client</label><select className="input" id="buyerKind" name="buyerKind" defaultValue="individual" required><option value="individual">Particulier</option><option value="professional">Professionnel</option></select></div><div className="field"><label htmlFor="buyerName">Nom / raison sociale</label><input className="input" id="buyerName" name="buyerName" defaultValue={data.sale.customer_name ?? ""} required/></div></div>
      <div className="field"><label htmlFor="buyerAddress">Adresse</label><textarea className="input" id="buyerAddress" name="buyerAddress"/><small>Obligatoire pour un professionnel. Pour un particulier, renseignez-la ou cochez l’opposition explicite ci-dessous.</small></div><label className="checkbox-field"><input type="checkbox" name="buyerAddressOmitted"/> Le particulier s’oppose à la mention de son adresse</label>
      <div className="form-grid"><Field name="buyerBillingAddress" label="Adresse de facturation si différente"/><Field name="buyerDeliveryAddress" label="Adresse de livraison si différente"/><Field name="buyerEmail" label="Email facultatif" type="email"/><Field name="buyerSiren" label="SIREN client facultatif" pattern="[0-9]{9}"/><Field name="buyerVatNumber" label="TVA intracommunautaire facultative"/><Field name="purchaseOrderReference" label="Bon de commande facultatif"/><Field name="paymentDueOn" label="Échéance de paiement" type="date" value={today} min={today} required/></div>
      <p className="declaration-warning">L’émission attribuera définitivement un numéro. La facture deviendra inaltérable. Toute correction monétaire devra ensuite passer par un avoir.</p><SubmitButton>Émettre la facture</SubmitButton>
    </form>}
  </>;
}

function Field({ name, label, type = "text", pattern, value, min, required }: { name: string; label: string; type?: string; pattern?: string; value?: string; min?: string; required?: boolean }) { return <div className="field"><label htmlFor={name}>{label}</label><input className="input" id={name} name={name} type={type} pattern={pattern} defaultValue={value} min={min} required={required}/></div>; }
