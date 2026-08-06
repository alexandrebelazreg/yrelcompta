import { describe, expect, it } from "vitest";
import {
  EXPENSE_DOCUMENT_SIZE_ERROR,
  MAX_EXPENSE_DOCUMENT_BYTES,
} from "./document-limits";
import {
  expenseFormSchema,
  expensePaymentSchema,
  validateExpenseFile,
} from "./validation";

const base = {
  purchasedOn: "2026-08-05",
  dueOn: "",
  supplierId: "",
  category: "software",
  subcategory: "",
  nature: "operating",
  costBehavior: "variable",
  description: "Abonnement",
  externalReference: "",
  totalAmount: "12,50",
  professionalShare: "100",
  notes: "",
};

describe("validation dépenses", () => {
  it("accepte un montant français", () =>
    expect(expenseFormSchema.parse(base).totalAmount).toBe(1250));
  it("refuse une part professionnelle invalide", () =>
    expect(
      expenseFormSchema.safeParse({ ...base, professionalShare: "101" }).success,
    ).toBe(false));
  it("refuse une échéance incohérente", () =>
    expect(
      expenseFormSchema.safeParse({ ...base, dueOn: "2026-08-04" }).success,
    ).toBe(false));
  it("refuse une date bancaire antérieure", () =>
    expect(
      expensePaymentSchema.safeParse({
        expenseId: crypto.randomUUID(),
        paidOn: "2026-08-05",
        bankDebitedOn: "2026-08-04",
        amount: "10",
        method: "card",
        externalReference: "",
        notes: "",
      }).success,
    ).toBe(false));
  it("utilise la limite partagée côté serveur", () => {
    expect(
      validateExpenseFile({
        name: "facture.pdf",
        size: MAX_EXPENSE_DOCUMENT_BYTES,
        type: "application/pdf",
      }),
    ).toBeNull();
    expect(
      validateExpenseFile({
        name: "facture.pdf",
        size: MAX_EXPENSE_DOCUMENT_BYTES + 1,
        type: "application/pdf",
      }),
    ).toBe(EXPENSE_DOCUMENT_SIZE_ERROR);
  });
  it("valide MIME, nom et extension", () => {
    expect(
      validateExpenseFile({
        name: "facture.exe",
        size: 10,
        type: "application/octet-stream",
      }),
    ).toMatch(/type/);
    expect(
      validateExpenseFile({
        name: "../facture.pdf",
        size: 10,
        type: "application/pdf",
      }),
    ).toMatch(/dangereux/);
    expect(
      validateExpenseFile({
        name: "facture.png",
        size: 10,
        type: "application/pdf",
      }),
    ).toMatch(/extension/);
  });
});
