import { describe, expect, it } from "vitest";
import { recurringSchema, supplierSchema } from "./validation";

describe("validation des fournisseurs", () => {
  const completeSupplier = {
    name: "Atelier Lumière",
    email: "contact@atelier.example",
    phone: "+33 1 23 45 67 89",
    website: "https://atelier.example",
    addressLine1: "12 rue des Fleurs",
    addressLine2: "Bâtiment B",
    postalCode: "75003",
    city: "Paris",
    countryCode: "fr",
    registrationNumber: "123 456 789 00012",
    notes: "Fournisseur principal",
    isActive: true,
  };

  it("conserve tous les champs et normalise le pays en majuscules", () => {
    const parsed = supplierSchema.parse(completeSupplier);
    expect(parsed).toMatchObject({
      addressLine1: "12 rue des Fleurs",
      addressLine2: "Bâtiment B",
      postalCode: "75003",
      city: "Paris",
      countryCode: "FR",
      registrationNumber: "123 456 789 00012",
    });
  });

  it("refuse un code pays qui n'a pas exactement deux lettres", () => {
    expect(
      supplierSchema.safeParse({ ...completeSupplier, countryCode: "FRA" }).success,
    ).toBe(false);
    expect(
      supplierSchema.safeParse({ ...completeSupplier, countryCode: "F1" }).success,
    ).toBe(false);
  });
});

describe("validation des modèles récurrents", () => {
  it("conserve une sous-catégorie renseignée", () => {
    const parsed = recurringSchema.parse({
      supplierId: "",
      category: "software",
      subcategory: "Comptabilité",
      nature: "operating",
      costBehavior: "fixed",
      description: "Abonnement mensuel",
      estimatedAmount: "29,99",
      professionalShare: "100",
      frequency: "monthly",
      nextDueOn: "2026-07-01",
      notes: "",
      isActive: true,
    });
    expect(parsed.subcategory).toBe("Comptabilité");
  });
});
