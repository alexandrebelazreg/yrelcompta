import { formatFrenchDate } from "@/lib/utils/format";

export type TodayTaskTone = "danger" | "brand" | "warning" | "info";

export interface TodayTask {
  id: string;
  tone: TodayTaskTone;
  title: string;
  detail: string;
  href: string;
  action: string;
}

export interface PendingDeclaration {
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  status: "to-declare" | "overdue";
}

export interface TodayTaskSource {
  draftSaleCount: number;
  draftExpenseCount: number;
  recurringDraftCount: number;
  missingDocumentCount: number;
  pendingDeclarations: PendingDeclaration[];
}

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count > 1 ? pluralForm : singular}`;

/**
 * Liste « À faire » de l’écran Aujourd’hui, de la plus urgente à la moins urgente :
 * déclarations en retard, puis à faire, ventes à valider, brouillons de dépenses, justificatifs.
 * Chaque tâche mène à l’écran où on la traite ; rien n’est validé directement depuis la liste.
 */
export function buildTodayTasks(source: TodayTaskSource): TodayTask[] {
  const tasks: TodayTask[] = [];
  const declarations = [...source.pendingDeclarations].sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  for (const declaration of declarations) {
    const year = declaration.periodEnd.slice(0, 4);
    const period = `Du ${formatFrenchDate(declaration.periodStart)} au ${formatFrenchDate(declaration.periodEnd)}`;
    tasks.push(declaration.status === "overdue"
      ? { id: `declaration-${declaration.periodStart}`, tone: "danger", title: "Déclaration de chiffre d’affaires en retard", detail: `${period} · échéance dépassée (${formatFrenchDate(declaration.dueOn)})`, href: `/registres/declarations?annee=${year}`, action: "Ouvrir" }
      : { id: `declaration-${declaration.periodStart}`, tone: "brand", title: "Déclaration de chiffre d’affaires à faire", detail: `${period} · avant le ${formatFrenchDate(declaration.dueOn)}`, href: `/registres/declarations?annee=${year}`, action: "Préparer" });
  }

  if (source.draftSaleCount > 0) {
    tasks.push({ id: "draft-sales", tone: "brand", title: `${plural(source.draftSaleCount, "vente", "ventes")} à valider`, detail: "Brouillons en attente de validation définitive", href: "/ventes?status=draft", action: "Voir" });
  }
  if (source.recurringDraftCount > 0) {
    tasks.push({ id: "recurring-drafts", tone: "info", title: `${plural(source.recurringDraftCount, "charge récurrente", "charges récurrentes")} à vérifier`, detail: "Brouillons créés automatiquement à l’échéance", href: "/depenses?statut=draft", action: "Vérifier" });
  }
  if (source.draftExpenseCount > 0) {
    tasks.push({ id: "draft-expenses", tone: "info", title: `${plural(source.draftExpenseCount, "dépense", "dépenses")} en brouillon`, detail: "À compléter puis valider", href: "/depenses?statut=draft", action: "Reprendre" });
  }
  if (source.missingDocumentCount > 0) {
    tasks.push({ id: "missing-documents", tone: "warning", title: `${plural(source.missingDocumentCount, "justificatif manquant", "justificatifs manquants")}`, detail: "Dépenses validées sans document joint", href: "/documents", action: "Ajouter" });
  }
  return tasks;
}

/** Date du jour en toutes lettres, heure de Paris : « Vendredi 13 novembre ». */
export function formatTodayLabel(now = new Date()): string {
  const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(now);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
