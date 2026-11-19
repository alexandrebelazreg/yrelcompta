"use client";

import { useActionState } from "react";
import { CreatableSelect } from "@/components/ui/creatable-select";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { addMaterialPurchaseAction } from "@/lib/products/purchase-actions";
import type { Supplier } from "@/types/expenses";

export function MaterialPurchaseForm({ materialId, unitLabel, suppliers, today }: { materialId: string; unitLabel: string; suppliers: Supplier[]; today: string }) {
  const [state, action] = useActionState(addMaterialPurchaseAction, {});
  const key = `purchase-${materialId}`;
  return <form action={action} className="compact-form form-stack">
    <input type="hidden" name="materialId" value={materialId}/>
    <div className="form-grid">
      <Field name="purchasedOn" id={`${key}-date`} label="Date d’achat" type="date" defaultValue={today} required error={state.fieldErrors?.purchasedOn?.[0]}/>
      <CreatableSelect id={`${key}-supplier`} name="supplierId" createName="newSupplierName" label="Fournisseur" defaultValue="" emptyLabel="Non renseigné" options={suppliers.filter((supplier) => supplier.is_active).map((supplier) => ({ value: supplier.id, label: supplier.name }))} createLabel="+ Nouveau fournisseur…" createPlaceholder="Nom du fournisseur" maxLength={160} error={state.fieldErrors?.newSupplierName?.[0]}/>
      <Field name="orderReference" id={`${key}-reference`} label="N° de commande" maxLength={200}/>
      <Field name="quantity" id={`${key}-quantity`} label={`Quantité (${unitLabel})`} inputMode="decimal" required error={state.fieldErrors?.quantity?.[0]}/>
      <Field name="totalCost" id={`${key}-cost`} label="Coût total TTC, frais compris (€)" inputMode="decimal" required error={state.fieldErrors?.totalCost?.[0]}/>
    </div>
    <label><input type="checkbox" name="excluded"/> Exclure du calcul du coût</label>
    <FormMessage message={state.error}/>
    <SubmitButton>Ajouter l’achat</SubmitButton>
  </form>;
}
