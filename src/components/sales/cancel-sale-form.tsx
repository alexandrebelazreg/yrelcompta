"use client";
import { useActionState, useState } from "react";
import { cancelSaleAction } from "@/lib/sales/actions";
import { cancellationSchema } from "@/lib/sales/validation";
import { TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

export function CancelSaleForm({ saleId }: { saleId: string }) {
  const [state, action] = useActionState(cancelSaleAction, {}); const [clientError, setClientError] = useState<string>();
  return <form action={action} className="form-stack compact-form" onSubmit={(event) => { const result = cancellationSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget))); if (!result.success) { event.preventDefault(); setClientError(result.error.issues[0]?.message); return; } setClientError(undefined); if (!window.confirm("Cette annulation est définitive. Confirmer ?")) event.preventDefault(); }}><input type="hidden" name="saleId" value={saleId} /><TextareaField name="reason" label="Motif de l’annulation" required maxLength={500} error={state.fieldErrors?.reason?.[0]} /><FormMessage message={clientError ?? state.error} /><SubmitButton>Annuler définitivement la vente</SubmitButton></form>;
}
