import { describe, expect, it } from "vitest";
import { materialPurchaseSchema, pickReferencePurchase, purchaseErrorMessage, LAST_COUNTED_PURCHASE_MESSAGE } from "./purchases";

const purchase = (id: string, quantity: number, cost: number, overrides: Record<string, unknown> = {}) => ({ id, quantity_milliunits: quantity, total_cost_cents: cost, excluded: false, purchased_on: "2026-10-01", created_at: "2026-10-01T10:00:00Z", ...overrides });

describe("coût retenu d’une matière", () => {
  it("retient le coût unitaire le plus élevé, ni le dernier ni la moyenne", () => {
    const purchases = [
      purchase("recent-cheap", 100_000, 500, { purchased_on: "2026-11-15" }), // 0,05 €/u
      purchase("old-expensive", 10_000, 120, { purchased_on: "2026-01-10" }), // 0,12 €/u
      purchase("middle", 50_000, 400), // 0,08 €/u
    ];
    expect(pickReferencePurchase(purchases)?.id).toBe("old-expensive");
  });

  it("ignore les achats exclus du calcul", () => {
    expect(pickReferencePurchase([purchase("outlier", 1_000, 900, { excluded: true }), purchase("normal", 10_000, 100)])?.id).toBe("normal");
    expect(pickReferencePurchase([purchase("only", 1_000, 900, { excluded: true })])).toBeNull();
  });

  it("compare exactement, sans erreur d’arrondi, et départage par la date la plus récente", () => {
    // 1/3 € par unité dans les deux cas : égalité exacte.
    const a = purchase("a", 3_000, 100, { purchased_on: "2026-03-01" });
    const b = purchase("b", 6_000, 200, { purchased_on: "2026-05-01" });
    expect(pickReferencePurchase([a, b])?.id).toBe("b");
    expect(pickReferencePurchase([b, a])?.id).toBe("b");
  });

  it("reste exact sur de très grands montants", () => {
    const big = purchase("big", 9_000_000_000_000_000, 9_000_000_000_000);
    const bigger = purchase("bigger", 8_999_999_999_999_999, 9_000_000_000_000);
    expect(pickReferencePurchase([big, bigger])?.id).toBe("bigger");
  });
});

describe("saisie d’un achat", () => {
  it("convertit quantités et montants en entiers", () => {
    const parsed = materialPurchaseSchema.parse({ purchasedOn: "2026-11-19", quantity: "1,5", totalCost: "12,50", supplierId: "", newSupplierName: " Perles & Co ", orderReference: " CMD-1 ", expenseId: "", excluded: false });
    expect(parsed).toMatchObject({ quantity: 1500, totalCost: 1250, newSupplierName: "Perles & Co", orderReference: "CMD-1" });
  });

  it("refuse une quantité ou un coût nul ou invalide", () => {
    expect(materialPurchaseSchema.safeParse({ purchasedOn: "2026-11-19", quantity: "0", totalCost: "1", supplierId: "", newSupplierName: "", orderReference: "", expenseId: "" }).success).toBe(false);
    expect(materialPurchaseSchema.safeParse({ purchasedOn: "2026-11-19", quantity: "1", totalCost: "0", supplierId: "", newSupplierName: "", orderReference: "", expenseId: "" }).success).toBe(false);
    expect(materialPurchaseSchema.safeParse({ purchasedOn: "19/11/2026", quantity: "1", totalCost: "1", supplierId: "", newSupplierName: "", orderReference: "", expenseId: "" }).success).toBe(false);
  });

  it("explique le refus de retirer le dernier achat compté", () => {
    expect(purchaseErrorMessage("23514", "at least one counted purchase required")).toBe(LAST_COUNTED_PURCHASE_MESSAGE);
  });
});
