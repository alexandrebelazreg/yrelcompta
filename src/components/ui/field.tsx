"use client";

import { useState, type FocusEvent, type InputEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

type Control = HTMLInputElement | HTMLTextAreaElement;

/**
 * Validation au fil de la saisie : le message du navigateur (champ requis, format, bornes…)
 * s’affiche quand on quitte le champ, et disparaît dès que la valeur redevient valide.
 * La validation serveur reste la référence ; son erreur est prioritaire.
 */
function useInlineValidation<E extends Control>(onBlur?: (event: FocusEvent<E>) => void, onInput?: (event: InputEvent<E>) => void) {
  const [clientError, setClientError] = useState<string>();
  return {
    clientError,
    onBlur(event: FocusEvent<E>) {
      onBlur?.(event);
      const control = event.currentTarget;
      setClientError(control.validity.valid ? undefined : control.validationMessage);
    },
    onInput(event: InputEvent<E>) {
      onInput?.(event);
      if (clientError && event.currentTarget.validity.valid) setClientError(undefined);
    },
  };
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Field({ label, error, id, className = "", onBlur, onInput, ...props }: FieldProps) {
  const fieldId = id ?? props.name;
  const validation = useInlineValidation(onBlur, onInput);
  const shownError = error ?? validation.clientError;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} className={`input ${className}`} aria-invalid={Boolean(shownError)} aria-describedby={shownError ? `${fieldId}-error` : undefined} {...props} onBlur={validation.onBlur} onInput={validation.onInput} />
      {shownError && <p className="field-error" id={`${fieldId}-error`}>{shownError}</p>}
    </div>
  );
}

export function TextareaField({ label, error, id, className = "", onBlur, onInput, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const fieldId = id ?? props.name;
  const validation = useInlineValidation(onBlur, onInput);
  const shownError = error ?? validation.clientError;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <textarea id={fieldId} className={`input min-h-24 ${className}`} aria-invalid={Boolean(shownError)} aria-describedby={shownError ? `${fieldId}-error` : undefined} {...props} onBlur={validation.onBlur} onInput={validation.onInput} />
      {shownError && <p className="field-error" id={`${fieldId}-error`}>{shownError}</p>}
    </div>
  );
}
