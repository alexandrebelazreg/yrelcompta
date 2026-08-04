"use client";
import { useActionState, useState, type FormEvent } from "react";
import { recordRefundAction } from "@/lib/sales/actions";
import { formatEuroCents } from "@/lib/sales/calculations";
import { refundKindLabels } from "@/lib/sales/labels";
import { refundFormSchema } from "@/lib/sales/validation";
import type { Payment } from "@/types/sales";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

export function RefundForm({ saleId, payment }: { saleId: string; payment: Payment }) {
  const [state, action] = useActionState(recordRefundAction, {}); const [clientError, setClientError] = useState<string>();
  const refunded = payment.refunds.reduce((sum, refund) => sum + refund.amount_cents, 0); const available = payment.gross_amount_cents - refunded;
  function validate(event: FormEvent<HTMLFormElement>) { const result = refundFormSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget))); if (!result.success) { event.preventDefault(); setClientError(result.error.issues[0]?.message); } else setClientError(undefined); }
  return <form action={action} onSubmit={validate} className="form-stack compact-form"><input type="hidden" name="saleId" value={saleId} /><input type="hidden" name="paymentId" value={payment.id} /><p className="available-refund">Encore remboursable : <strong>{formatEuroCents(available)}</strong></p><div className="form-grid"><Field name="refundedOn" type="date" label="Date du remboursement" min={payment.received_on} defaultValue={new Date().toISOString().slice(0, 10)} required error={state.fieldErrors?.refundedOn?.[0]} /><Field name="amount" label="Montant (€)" inputMode="decimal" defaultValue={(available / 100).toFixed(2).replace(".", ",")} required error={state.fieldErrors?.amount?.[0]} /><div className="field"><label htmlFor={`kind-${payment.id}`}>Type</label><select className="input" id={`kind-${payment.id}`} name="kind">{Object.entries(refundKindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></div><TextareaField name="reason" label="Motif" required maxLength={500} error={state.fieldErrors?.reason?.[0]} /><FormMessage message={clientError ?? state.error} /><SubmitButton>Enregistrer le remboursement</SubmitButton></form>;
}
