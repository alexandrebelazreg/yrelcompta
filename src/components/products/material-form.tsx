"use client";

import { useActionState, useState } from "react";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { CreatableSelect } from "@/components/ui/creatable-select";
import { saveMaterialAction } from "@/lib/products/actions";
import { formatMilliunits } from "@/lib/products/calculations";
import { materialUnitLabels } from "@/lib/products/labels";
import { normalizeReferencePrefix, suggestNextReference, suggestReferencePrefix } from "@/lib/products/references";
import type { Material, MaterialCategory } from "@/types/products";
import type { Supplier } from "@/types/expenses";

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const CREATE_CATEGORY = "__create__";

interface MaterialFormProps {
  material?: Material;
  suppliers: Supplier[];
  colors: string[];
  categories: MaterialCategory[];
  /** Références déjà utilisées, pour proposer le prochain numéro libre. */
  references: Array<string | null>;
}

export function MaterialForm({ material, suppliers, colors, categories, references }: MaterialFormProps) {
  const [state, action] = useActionState(saveMaterialAction, {});
  const key = material?.id ?? "new";
  const [categoryId, setCategoryId] = useState(material?.category_id ?? "");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryPrefix, setNewCategoryPrefix] = useState("");
  const [prefixEdited, setPrefixEdited] = useState(false);
  const [reference, setReference] = useState(material?.internal_reference ?? "");
  // La référence n’est pré-remplie que tant que l’utilisatrice ne l’a pas saisie elle-même.
  const [referenceAuto, setReferenceAuto] = useState(!material?.internal_reference);

  function applyPrefix(prefix: string) {
    if (referenceAuto) setReference(suggestNextReference(prefix, references));
  }

  function chooseCategory(value: string) {
    if (value === CREATE_CATEGORY) {
      setCreatingCategory(true);
      applyPrefix(newCategoryPrefix);
      return;
    }
    setCategoryId(value);
    applyPrefix(categories.find((category) => category.id === value)?.reference_prefix ?? "");
  }

  function changeNewCategoryName(name: string) {
    setNewCategoryName(name);
    if (!prefixEdited) {
      const prefix = suggestReferencePrefix(name);
      setNewCategoryPrefix(prefix);
      applyPrefix(prefix);
    }
  }

  function changeNewCategoryPrefix(value: string) {
    const prefix = normalizeReferencePrefix(value);
    setPrefixEdited(true);
    setNewCategoryPrefix(prefix);
    applyPrefix(prefix);
  }

  function cancelNewCategory() {
    setCreatingCategory(false);
    applyPrefix(categories.find((category) => category.id === categoryId)?.reference_prefix ?? "");
  }

  return <form action={action} className="compact-form form-stack">
    {material && <input type="hidden" name="materialId" value={material.id}/>}
    <div className="form-grid">
      <Field name="name" id={`name-${key}`} label="Nom" defaultValue={material?.name ?? ""} required maxLength={160} error={state.fieldErrors?.name?.[0]}/>
      <div className="field">
        <label htmlFor={`category-${key}`}>Catégorie</label>
        {creatingCategory
          ? <div className="creatable-select-new">
              <input className="input" id={`category-${key}`} name="newCategoryName" value={newCategoryName} onChange={(event) => changeNewCategoryName(event.target.value)} required maxLength={60} placeholder="Ex. Chaîne principale" autoFocus aria-invalid={Boolean(state.fieldErrors?.newCategoryName)}/>
              <button className="secondary-link" type="button" onClick={cancelNewCategory}>Annuler</button>
            </div>
          : <select className="input" id={`category-${key}`} name="categoryId" value={categoryId} onChange={(event) => chooseCategory(event.target.value)}>
              <option value="">Sans catégorie</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.reference_prefix})</option>)}
              <option value={CREATE_CATEGORY}>+ Nouvelle catégorie…</option>
            </select>}
        {state.fieldErrors?.newCategoryName?.[0] && <p className="field-error">{state.fieldErrors.newCategoryName[0]}</p>}
      </div>
      {creatingCategory && <Field name="newCategoryPrefix" id={`prefix-${key}`} label="Préfixe de référence" value={newCategoryPrefix} onChange={(event) => changeNewCategoryPrefix(event.target.value)} required maxLength={10} placeholder="Ex. CP" error={state.fieldErrors?.newCategoryPrefix?.[0]}/>}
      <Field name="internalReference" id={`reference-${key}`} label="Référence interne" value={reference} onChange={(event) => { setReference(event.target.value); setReferenceAuto(event.target.value === ""); }} maxLength={80}/>
      <CreatableSelect id={`supplier-${key}`} name="supplierId" createName="newSupplierName" label="Fournisseur" defaultValue={material?.supplier_id ?? ""} emptyLabel="Aucun" options={suppliers.filter((supplier) => supplier.is_active || supplier.id === material?.supplier_id).map((supplier) => ({ value: supplier.id, label: supplier.name }))} createLabel="+ Nouveau fournisseur…" createPlaceholder="Nom du fournisseur" maxLength={160} error={state.fieldErrors?.newSupplierName?.[0]}/>
      <CreatableSelect id={`color-${key}`} name="color" label="Couleur" defaultValue={material?.color ?? ""} emptyLabel="Non précisée" options={colors.map((color) => ({ value: color, label: color }))} createLabel="+ Nouvelle couleur…" createPlaceholder="Ex. Or rose" maxLength={60} error={state.fieldErrors?.color?.[0]}/>
      <div className="field">
        <label htmlFor={`unit-${key}`}>Unité de consommation</label>
        <select className="input" id={`unit-${key}`} name="unit" defaultValue={material?.unit ?? "piece"}>{Object.entries(materialUnitLabels).map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select>
      </div>
      <Field name="packageQuantity" id={`quantity-${key}`} label="Quantité du lot" inputMode="decimal" defaultValue={material ? formatMilliunits(material.package_quantity_milliunits) : ""} required error={state.fieldErrors?.packageQuantity?.[0]}/>
      <Field name="packageCost" id={`cost-${key}`} label="Coût TTC du lot (€)" inputMode="decimal" defaultValue={material ? money(material.package_cost_cents) : ""} required error={state.fieldErrors?.packageCost?.[0]}/>
    </div>
    <TextareaField name="notes" id={`notes-${key}`} label="Notes" defaultValue={material?.notes ?? ""} maxLength={2000}/>
    <label><input type="checkbox" name="isActive" defaultChecked={material?.is_active ?? true}/> Matière active</label>
    <FormMessage message={state.error}/>
    <SubmitButton>{material ? "Mettre à jour" : "Créer la matière"}</SubmitButton>
  </form>;
}
