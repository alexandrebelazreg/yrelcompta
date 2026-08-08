import type { FiscalReserveUnavailableReason } from "@/types/fiscal-social";

export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) throw new Error("FISCAL_INVALID_RATE");
  const sign = basisPoints < 0 ? "−" : "";
  const absolute = Math.abs(basisPoints);
  const whole = Math.floor(absolute / 100);
  const decimal = String(absolute % 100).padStart(2, "0").replace(/0+$/, "");
  return `${sign}${whole}${decimal ? `,${decimal}` : ""} %`;
}

export const fiscalReserveUnavailableMessages: Record<FiscalReserveUnavailableReason, string> = {
  "refund-review-required": "Revue nécessaire : ce mois contient un remboursement client. Aucune assiette fiscale n’est inventée.",
  "vat-unmodeled": "Estimation indisponible : la ventilation hors taxes / TVA n’est pas modélisée.",
  "profile-not-configured": "Paramètres fiscaux à configurer avant de produire une estimation.",
  "rule-not-available": "Règle légale non disponible pour cette date.",
  "acre-cap-unmodeled": "Estimation indisponible pendant l’ACRE : le plafond légal d’exonération n’est pas encore modélisé.",
};
