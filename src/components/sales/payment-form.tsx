"use client";
import { useActionState, useMemo, useState, type FormEvent } from "react";
import { recordPaymentAction } from "@/lib/sales/actions";
import { formatEuroCents, parseFrenchMoneyToCents } from "@/lib/sales/calculations";
import { paymentMethodLabels } from "@/lib/sales/labels";
import { paymentFormSchema } from "@/lib/sales/validation";
import { getTodayInParis } from "@/lib/utils/date";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

export function PaymentForm({ saleId, remainingCents }: { saleId: string; remainingCents: number }) {
  const [state, action] = useActionState(recordPaymentAction, {});
  const [gross, setGross] = useState((remainingCents / 100).toFixed(2).replace(".", ","));
  const [fee, setFee] = useState("0,00");
  const [clientError, setClientError] = useState<string>();
  const net = useMemo(() => Math.max(0, safe(gross) - safe(fee)), [gross, fee]);
  function validate(event: FormEvent<HTMLFormElement>) {
    const result = paymentFormSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!result.success) { event.preventDefault(); setClientError(result.error.issues[0]?.message); } else setClientError(undefined);
  }
  return <form action={action} onSubmit={validate} className="form-stack compact-form"><input type="hidden" name="saleId" value={saleId} /><div className="form-grid"><Field name="receivedOn" type="date" label="Date d’encaissement" defaultValue={getTodayInParis()} required error={state.fieldErrors?.receivedOn?.[0]} /><div className="field"><label htmlFor="method">Moyen de paiement</label><select className="input" id="method" name="method">{Object.entries(paymentMethodLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><Field name="grossAmount" label="Montant brut (€)" inputMode="decimal" value={gross} onChange={(event) => setGross(event.target.value)} required error={state.fieldErrors?.grossAmount?.[0]} /><Field name="platformFee" label="Commission de plateforme (€)" inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} error={state.fieldErrors?.platformFee?.[0]} /><Field name="bankDepositedOn" type="date" label="Date de versement bancaire (facultative)" error={state.fieldErrors?.bankDepositedOn?.[0]} /><Field name="externalReference" label="Référence externe (facultative)" error={state.fieldErrors?.externalReference?.[0]} /></div><TextareaField name="notes" label="Notes (facultatives)" error={state.fieldErrors?.notes?.[0]} /><div className="financial-note"><strong>Net versé : {formatEuroCents(net)}</strong><span>La commission ne réduit pas le chiffre d’affaires encaissé.</span></div><FormMessage message={clientError ?? state.error} /><SubmitButton>Enregistrer l’encaissement</SubmitButton></form>;
}
function safe(value: string) { try { return parseFrenchMoneyToCents(value || "0"); } catch { return 0; } }
