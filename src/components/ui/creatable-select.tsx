"use client";

import { useState } from "react";

const CREATE_VALUE = "__create__";

interface CreatableSelectProps {
  id: string;
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  /** Option vide facultative, par exemple « Aucun ». */
  emptyLabel?: string;
  createLabel: string;
  createPlaceholder?: string;
  /** Nom du champ texte envoyé lors d’une création ; par défaut le même que la liste. */
  createName?: string;
  maxLength: number;
  error?: string;
}

/** Liste déroulante permettant de choisir une valeur existante ou d’en saisir une nouvelle. */
export function CreatableSelect({ id, name, label, options, defaultValue = "", emptyLabel, createLabel, createPlaceholder, createName = name, maxLength, error }: CreatableSelectProps) {
  const [creating, setCreating] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const known = options.some((option) => option.value === value) || (emptyLabel !== undefined && value === "");
  const entries = known || value === "" ? options : [...options, { value, label: value }];

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {creating
      ? <div className="creatable-select-new">
          <input className="input" id={id} name={createName} required maxLength={maxLength} placeholder={createPlaceholder} autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}/>
          <button className="secondary-link" type="button" onClick={() => setCreating(false)}>Annuler</button>
        </div>
      : <select className="input" id={id} name={name} value={value} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { if (event.target.value === CREATE_VALUE) setCreating(true); else setValue(event.target.value); }}>
          {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
          {entries.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          <option value={CREATE_VALUE}>{createLabel}</option>
        </select>}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>;
}
