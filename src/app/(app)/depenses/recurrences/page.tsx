import Link from "next/link";
import { RecurringForm } from "@/components/expenses/recurring-form";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { InfoTip } from "@/components/ui/info-tip";
import { archiveRecurringAction, createExpenseFromTemplateAction } from "@/lib/expenses/actions";
import { listRecurringTemplates, listSuppliers } from "@/lib/expenses/queries";
import { recurrenceFrequencyLabels } from "@/lib/expenses/labels";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { formatEuroCents } from "@/lib/sales/calculations";
import { getTodayInParis } from "@/lib/utils/date";
import { formatFrenchDate } from "@/lib/utils/format";

export default async function RecurrencesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const [rows, suppliers] = await Promise.all([listRecurringTemplates(context.business.id), listSuppliers(context.business.id)]);
  const today = getTodayInParis();
  const error = typeof p.erreur === "string" ? p.erreur : undefined;
  const message = typeof p.message === "string" ? (p.message === "archive" ? "Le modèle a été archivé." : "Le modèle a été enregistré.") : undefined;

  return <>
    <Link className="back-link" href="/depenses">← Dépenses</Link>
    <header className="page-header"><div className="info-line"><h1>Charges récurrentes</h1><InfoTip label="À propos de la création des charges récurrentes">Aucune génération automatique : chaque brouillon est créé à votre demande.</InfoTip></div></header>
    {message && <p className="form-message success">{message}</p>}
    {error && <p className="form-message">{error}</p>}
    <details className="action-panel"><summary className="button">Nouveau modèle</summary><RecurringForm suppliers={suppliers}/></details>
    <div className="register-table-wrap compact-table-wrap recurring-table-wrap"><table className="register-table compact-table management-table recurring-table"><thead><tr><th>Description</th><th>Fournisseur</th><th>Sous-catégorie</th><th>Fréquence</th><th>Montant estimé</th><th>Prochaine échéance</th><th>État</th><th>Actions</th></tr></thead><tbody>{rows.map((template) => { const supplierName = template.suppliers?.name ?? "Sans fournisseur"; const isOverdue = template.next_due_on < today; const status = template.is_active ? (isOverdue ? "overdue" : "upcoming") : "archived"; const statusLabel = template.is_active ? (isOverdue ? "En retard" : "À venir") : "Archivé"; return <tr key={template.id}><td className="compact-primary-cell compact-description recurring-main"><strong>{template.description}</strong></td><td className="recurring-supplier">{supplierName}</td><td className="recurring-subcategory">{template.subcategory ?? "—"}</td><td className="recurring-frequency">{recurrenceFrequencyLabels[template.frequency]}</td><td className="compact-amount recurring-amount">{formatEuroCents(template.estimated_amount_cents)}</td><td className="recurring-next-due">{formatFrenchDate(template.next_due_on)}</td><td className="recurring-status-cell"><span className={`management-status management-status-${status}`}>{statusLabel}</span></td><td className="compact-actions management-actions recurring-actions"><details className="table-action-details"><summary className="table-action-link">Modifier</summary><div className="table-action-form"><RecurringForm template={template} suppliers={suppliers}/></div></details>{template.is_active && <><details className="table-action-details create-now-details"><summary className="table-action-link">Créer maintenant</summary><form action={createExpenseFromTemplateAction} className="table-create-form"><input type="hidden" name="templateId" value={template.id}/><div className="field"><label htmlFor={`purchased-${template.id}`}>Date d’achat</label><input className="input" id={`purchased-${template.id}`} name="purchasedOn" type="date" defaultValue={today} required/></div><ConfirmSubmitButton message="Créer maintenant un brouillon depuis ce modèle ?">Créer maintenant</ConfirmSubmitButton></form></details><form action={archiveRecurringAction} className="table-inline-form"><input type="hidden" name="templateId" value={template.id}/><ConfirmSubmitButton danger message="Archiver ce modèle ?">Archiver</ConfirmSubmitButton></form></>}</td><td className="compact-mobile-context recurring-mobile-context">{supplierName} · {template.subcategory ?? "Sans sous-catégorie"} · {recurrenceFrequencyLabels[template.frequency]}</td><td className="compact-mobile-financials recurring-mobile-financials">Prochaine échéance : {formatFrenchDate(template.next_due_on)}</td></tr>; })}</tbody></table></div>
  </>;
}
