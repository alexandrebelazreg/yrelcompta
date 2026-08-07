import type { FixedCostCoverageUnavailableReason } from "@/types/dashboard";

const unavailableMessages: Record<FixedCostCoverageUnavailableReason, string> = {
  "fixed-costs-not-configured": "Configurez vos charges récurrentes fixes pour calculer l’écart de couverture.",
  "no-monthly-sales": "Aucune vente validée sur ce mois pour calculer l’écart de couverture.",
  "incomplete-monthly-costing": "Écart indisponible tant que toutes les ventes du mois ne disposent pas d’un coût historique complet.",
};

export function fixedCostCoverageMessage(reason: FixedCostCoverageUnavailableReason | null): string {
  return reason === null
    ? "Marge de fabrication moins charges fixes récurrentes estimées. Ce montant n’intègre pas encore cotisations, fiscalité ni tous les frais commerciaux."
    : unavailableMessages[reason];
}
