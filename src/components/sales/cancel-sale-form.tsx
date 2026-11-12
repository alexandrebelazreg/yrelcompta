"use client";
import { useActionState, useState } from "react";
import { cancelSaleAction } from "@/lib/sales/actions";
import { cancellationSchema } from "@/lib/sales/validation";
import { TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";

export function CancelSaleForm({ saleId }: { saleId: string }) {
  const [state, action] = useActionState(cancelSaleAction, {}); const [clientError, setClientError] = useState<string>();
  return <form action={action} className="form-stack compact-form" onSubmit={(event) => { const result = cancellationSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget))); if (!result.success) { event.preventDefault(); event.currentTarget.querySelector("dialog")?.close(); setClientError(result.error.issues[0]?.message); return; } setClientError(undefined); }}><input type="hidden" name="saleId" value={saleId} /><TextareaField name="reason" label="Motif de l’annulation" required minLength={2} maxLength={500} error={state.fieldErrors?.reason?.[0]} /><FormMessage message={clientError ?? state.error} /><ConfirmSubmitButton danger message="Cette annulation est définitive. Confirmer ?">Annuler définitivement la vente</ConfirmSubmitButton></form>;
}
