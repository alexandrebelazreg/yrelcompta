import { describe, expect, it } from "vitest";
import {
  calculateCumulativeProfessionalAllocation,
  calculateCumulativeRefundAllocation,
  calculateProfessionalAmount,
} from "./calculations";

const sqlNumericRound = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator / BigInt(2)) / denominator;

describe("calculs monétaires exacts sur les grands montants", () => {
  const gross = 9_000_000_000_000;
  const basisPoints = 9_999;
  const expectedBusiness = Number(
    sqlNumericRound(BigInt(gross) * BigInt(basisPoints), BigInt(10_000)),
  );

  it("reste identique à l'arrondi numeric SQL sans perte de précision", () => {
    expect(calculateProfessionalAmount(gross, basisPoints)).toBe(expectedBusiness);
  });

  it("répartit un paiement intégral élevé sans dépasser le brut", () => {
    const payments = [4_499_999_999_999, 4_500_000_000_001];
    let paid = 0;
    let businessPaid = 0;
    for (const payment of payments) {
      const allocation = calculateCumulativeProfessionalAllocation(
        paid,
        businessPaid,
        payment,
        basisPoints,
      );
      expect(allocation).toBeGreaterThanOrEqual(0);
      expect(allocation).toBeLessThanOrEqual(payment);
      paid += payment;
      businessPaid += allocation;
    }
    expect(businessPaid).toBe(expectedBusiness);
  });

  it("inverse exactement un grand paiement après plusieurs remboursements", () => {
    const refunds = [3_000_000_000_001, 2_999_999_999_999, 3_000_000_000_000];
    let refunded = 0;
    let businessRefunded = 0;
    for (const refund of refunds) {
      const allocation = calculateCumulativeRefundAllocation(
        gross,
        expectedBusiness,
        refunded,
        businessRefunded,
        refund,
      );
      expect(allocation).toBeGreaterThanOrEqual(0);
      expect(allocation).toBeLessThanOrEqual(refund);
      refunded += refund;
      businessRefunded += allocation;
    }
    expect(refunded).toBe(gross);
    expect(businessRefunded).toBe(expectedBusiness);
  });
});
