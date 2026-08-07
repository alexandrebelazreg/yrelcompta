import type { DeclarationCalculationStatus, DeclarationUiStatus } from "@/types/registers";

export const declarationUiStatusLabels: Record<DeclarationUiStatus, string> = {
  upcoming: "À venir",
  "to-declare": "À déclarer",
  overdue: "En retard",
  declared: "Déclarée",
};

const declarationSuccessMessages: Record<string, string> = {
  "date-enregistree": "Date de début d’activité enregistrée.",
  "declaration-enregistree": "Déclaration enregistrée dans YrelCompta.",
  "correction-enregistree": "Correction enregistrée dans YrelCompta.",
};

export function declarationSuccessMessage(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? declarationSuccessMessages[value] ?? null : null;
}

export const calculationStatusMessages: Record<DeclarationCalculationStatus, string> = {
  available: "Le montant proposé correspond aux encaissements bruts de la période, sans déduction des commissions ou dépenses.",
  "vat-unmodeled": "Calcul automatique indisponible : YrelCompta ne décompose pas encore la TVA des ventes. Saisissez le montant HT effectivement déclaré.",
  "refund-review-required": "Des remboursements clients existent sur cette période. Leur traitement déclaratif doit être vérifié avant validation ; YrelCompta ne les déduit pas automatiquement du chiffre d’affaires à déclarer.",
};
