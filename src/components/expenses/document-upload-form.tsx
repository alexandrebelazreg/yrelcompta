"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { uploadExpenseDocumentAction } from "@/lib/expenses/actions";
import {
  EXPENSE_DOCUMENT_SIZE_ERROR,
  getExpenseDocumentSizeError,
} from "@/lib/expenses/document-limits";
import { documentKindLabels } from "@/lib/expenses/labels";

export function ExpenseDocumentUploadForm({ expenseId }: { expenseId: string }) {
  const [sizeError, setSizeError] = useState<string | null>(null);

  function validateSelection(file: File | null) {
    const error = file ? getExpenseDocumentSizeError(file.size) : null;
    setSizeError(error);
    return error;
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    validateSelection(event.currentTarget.files?.[0] ?? null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const selected = new FormData(event.currentTarget).get("file");
    const error =
      selected instanceof File
        ? getExpenseDocumentSizeError(selected.size)
        : null;
    if (error) {
      event.preventDefault();
      setSizeError(EXPENSE_DOCUMENT_SIZE_ERROR);
    }
  }

  return (
    <form
      action={uploadExpenseDocumentAction}
      className="compact-form upload-form"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="expenseId" value={expenseId} />
      <div className="field">
        <label htmlFor="kind">Type</label>
        <select className="input" id="kind" name="kind">
          {Object.entries(documentKindLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="file">Fichier privé (10 Mio maximum)</label>
        <input
          aria-describedby={sizeError ? "expense-document-size-error" : undefined}
          aria-invalid={Boolean(sizeError)}
          className="input"
          id="file"
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          onChange={handleChange}
          required
        />
        {sizeError && (
          <p
            className="field-error"
            id="expense-document-size-error"
            role="alert"
          >
            {sizeError}
          </p>
        )}
      </div>
      <button className="button" disabled={Boolean(sizeError)} type="submit">
        Joindre
      </button>
    </form>
  );
}
