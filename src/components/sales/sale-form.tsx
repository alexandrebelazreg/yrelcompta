"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, type FormEvent } from "react";
import { saveSaleDraftAction } from "@/lib/sales/actions";
import { calculateSaleSubtotal, formatEuroCents, parseFrenchMoneyToCents } from "@/lib/sales/calculations";
import { saleChannelLabels } from "@/lib/sales/labels";
import { saleFormSchema } from "@/lib/sales/validation";
import { getTodayInParis as today } from "@/lib/utils/date";
import type { Sale } from "@/types/sales";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

interface EditableItem { key: string; description: string; quantity: string; unitPrice: string; }
const moneyInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function SaleForm({ sale }: { sale?: Sale }) {
  const initialItems = sale?.sale_items.map((item) => ({ key: item.id ?? crypto.randomUUID(), description: item.description, quantity: String(item.quantity), unitPrice: moneyInput(item.unit_price_cents) }))
    ?? [{ key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "" }];
  const [items, setItems] = useState<EditableItem[]>(initialItems);
  const [shipping, setShipping] = useState(sale ? moneyInput(sale.shipping_cents) : "0,00");
  const [discount, setDiscount] = useState(sale ? moneyInput(sale.discount_cents) : "0,00");
  const [clientError, setClientError] = useState<string>();
  const [state, action] = useActionState(saveSaleDraftAction, {});

  const preview = useMemo(() => {
    const parsedItems = items.map((item) => ({ quantity: Number(item.quantity) || 0, unit_price_cents: safeCents(item.unitPrice) }));
    const subtotal = calculateSaleSubtotal(parsedItems); const shippingCents = safeCents(shipping); const discountCents = safeCents(discount);
    return { subtotal, shippingCents, discountCents, total: Math.max(0, subtotal + shippingCents - discountCents) };
  }, [items, shipping, discount]);

  function updateItem(key: string, patch: Partial<EditableItem>) { setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item)); }
  function validate(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    const result = saleFormSchema.safeParse({ saleId: sale?.id, orderedOn: form.get("orderedOn"), channel: form.get("channel"), customerName: form.get("customerName"), notes: form.get("notes"), shipping, discount, items: items.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })) });
    if (!result.success) { event.preventDefault(); setClientError(result.error.issues[0]?.message ?? "Corrigez le formulaire."); } else setClientError(undefined);
  }
  const serializedItems = JSON.stringify(items.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })));
  return <form action={action} onSubmit={validate} className="sale-form form-stack" noValidate>
    {sale && <input type="hidden" name="saleId" value={sale.id} />}<input type="hidden" name="items" value={serializedItems} />
    <div className="form-grid"><Field name="orderedOn" type="date" label="Date de commande" defaultValue={sale?.ordered_on ?? today()} required error={state.fieldErrors?.orderedOn?.[0]} /><div className="field"><label htmlFor="channel">Canal de vente</label><select className="input" id="channel" name="channel" defaultValue={sale?.channel ?? "direct"}>{Object.entries(saleChannelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
    <Field name="customerName" label="Nom de la cliente (facultatif)" defaultValue={sale?.customer_name ?? ""} maxLength={160} error={state.fieldErrors?.customerName?.[0]} />
    <TextareaField name="notes" label="Notes (facultatives)" defaultValue={sale?.notes ?? ""} maxLength={2000} error={state.fieldErrors?.notes?.[0]} />
    <fieldset className="sale-lines"><legend>Lignes de vente</legend>{items.map((item, index) => <div className="sale-line" key={item.key}>
      <Field id={`item-description-${item.key}`} label={`Description ${index + 1}`} value={item.description} onChange={(event) => updateItem(item.key, { description: event.target.value })} required maxLength={300} />
      <Field id={`item-quantity-${item.key}`} label="Quantité" type="number" inputMode="numeric" min={1} max={999} value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} required />
      <Field id={`item-price-${item.key}`} label="Prix unitaire (€)" inputMode="decimal" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })} required />
      <button className="text-button danger-text" type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((line) => line.key !== item.key))}>Supprimer cette ligne</button>
    </div>)}<button className="secondary-link add-line" type="button" onClick={() => setItems((current) => [...current, { key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "" }])}>+ Ajouter une ligne</button></fieldset>
    <div className="form-grid"><Field name="shipping" label="Frais de livraison (€)" inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} error={state.fieldErrors?.shipping?.[0]} /><Field name="discount" label="Remise (€)" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} error={state.fieldErrors?.discount?.[0]} /></div>
    <aside className="sale-preview" aria-live="polite"><p><span>Sous-total</span><strong>{formatEuroCents(preview.subtotal)}</strong></p><p><span>Livraison</span><strong>{formatEuroCents(preview.shippingCents)}</strong></p><p><span>Remise</span><strong>− {formatEuroCents(preview.discountCents)}</strong></p><p className="preview-total"><span>Total</span><strong>{formatEuroCents(preview.total)}</strong></p></aside>
    <FormMessage message={clientError ?? state.error} /><div className="form-actions"><SubmitButton>{sale ? "Enregistrer les modifications" : "Enregistrer le brouillon"}</SubmitButton><Link className="secondary-link" href={sale ? `/ventes/${sale.id}` : "/ventes"}>Annuler</Link></div>
  </form>;
}

function safeCents(value: string): number { try { return parseFrenchMoneyToCents(value || "0"); } catch { return 0; } }
