"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateMaterialCategoryAction } from "@/lib/products/actions";
import type { MaterialCategory } from "@/types/products";

export function MaterialCategoryForm({ category }: { category: MaterialCategory }) {
  const [state, action] = useActionState(updateMaterialCategoryAction, {});
  return <form action={action} className="material-category-form">
    <input type="hidden" name="categoryId" value={category.id}/>
    <Field name="name" id={`category-name-${category.id}`} label="Nom" defaultValue={category.name} required maxLength={60} error={state.fieldErrors?.name?.[0]}/>
    <Field name="referencePrefix" id={`category-prefix-${category.id}`} label="Préfixe" defaultValue={category.reference_prefix} required maxLength={10} error={state.fieldErrors?.referencePrefix?.[0]}/>
    <SubmitButton>Enregistrer</SubmitButton>
    <FormMessage message={state.error}/>
  </form>;
}
