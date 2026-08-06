import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPENSE_DOCUMENT_SIZE_ERROR,
  getExpenseDocumentSizeError,
  MAX_EXPENSE_DOCUMENT_BYTES,
} from "./document-limits";

describe("limite des justificatifs", () => {
  it("accepte exactement 10 Mio", () => {
    expect(MAX_EXPENSE_DOCUMENT_BYTES).toBe(10_485_760);
    expect(getExpenseDocumentSizeError(10_485_760)).toBeNull();
  });

  it("refuse un octet de plus avec le message exact", () => {
    expect(getExpenseDocumentSizeError(10_485_761)).toBe(
      "Le fichier doit peser au maximum 10 Mio.",
    );
    expect(EXPENSE_DOCUMENT_SIZE_ERROR).toBe(
      "Le fichier doit peser au maximum 10 Mio.",
    );
  });

  it("bloque la soumission navigateur avant la Server Action", () => {
    const component = readFileSync(
      join(
        process.cwd(),
        "src/components/expenses/document-upload-form.tsx",
      ),
      "utf8",
    );
    expect(component).toContain("event.preventDefault()");
    expect(component).toContain("getExpenseDocumentSizeError(selected.size)");
    expect(component).toContain("{sizeError}");
    expect(component).toContain('role="alert"');
  });

  it("garde la limite métier indépendante de la limite de transport", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    const validation = readFileSync(
      join(process.cwd(), "src/lib/expenses/validation.ts"),
      "utf8",
    );
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260805180000_expenses_documents.sql",
      ),
      "utf8",
    );
    expect(config).toContain('bodySizeLimit: "16mb"');
    expect(config).not.toContain("10485760");
    expect(validation).toContain("getExpenseDocumentSizeError(file.size)");
    expect(migration).toContain("false,10485760");
  });
});
