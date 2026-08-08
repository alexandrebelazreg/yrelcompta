import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { ExpenseStatusBadge } from "@/components/expenses/status-badge";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { calculateExpenseFinancials } from "@/lib/expenses/calculations";
import { expenseCategoryLabels, expenseStatusLabels } from "@/lib/expenses/labels";
import { getExpensesOverview, listExpenses, listSuppliers } from "@/lib/expenses/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";
import type { ExpenseCategory, ExpenseStatus } from "@/types/expenses";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const status = typeof p.statut === "string" && p.statut in expenseStatusLabels ? p.statut as ExpenseStatus : undefined;
  const category = typeof p.categorie === "string" && p.categorie in expenseCategoryLabels ? p.categorie as ExpenseCategory : undefined;
  const supplierId = typeof p.fournisseur === "string" ? p.fournisseur : undefined;
  const from = typeof p.debut === "string" ? p.debut : undefined;
  const to = typeof p.fin === "string" ? p.fin : undefined;
  const search = typeof p.recherche === "string" ? p.recherche : undefined;
  const documents = p.justificatif === "avec" ? "with" : p.justificatif === "sans" ? "without" : undefined;
  const [{ expenses, totals }, filtered, suppliers] = await Promise.all([
    getExpensesOverview(context.business.id),
    listExpenses(context.business.id, { status, category, supplierId, from, to, search, documents }),
    listSuppliers(context.business.id),
  ]);

  return <>
    <header className="page-header"><div className="info-line"><h1>Dépenses</h1><InfoTip label="À propos du suivi des dépenses">Factures, paiements, remboursements et justificatifs.</InfoTip></div><div className="header-actions"><Link className="secondary-link" href="/depenses/fournisseurs">Fournisseurs</Link><Link className="secondary-link" href="/depenses/recurrences">Charges récurrentes</Link><Link className="button-link" href="/depenses/nouvelle">Nouvelle dépense</Link></div></header>
    <section className="expense-summary"><Card><p>Dépenses validées</p><strong>{formatEuroCents(totals.validatedExpensesCents)}</strong></Card><Card><p>Payé brut</p><strong>{formatEuroCents(totals.grossPaidCents)}</strong></Card><Card><p>Remboursé par les fournisseurs</p><strong>{formatEuroCents(totals.grossRefundedCents)}</strong></Card><Card><p>Dépenses nettes</p><strong>{formatEuroCents(totals.netBusinessCents)}</strong></Card><Card><p>Reste à payer</p><strong>{formatEuroCents(totals.remainingCents)}</strong></Card><Card><p>Justificatifs manquants</p><strong>{totals.missingDocuments}</strong></Card></section>
    <form className="expense-filters"><Select name="statut" label="Statut" value={status} entries={expenseStatusLabels}/><Select name="categorie" label="Catégorie" value={category} entries={expenseCategoryLabels}/><Select name="fournisseur" label="Fournisseur" value={supplierId} entries={Object.fromEntries(suppliers.map((supplier) => [supplier.id, supplier.name]))}/><div className="field"><label htmlFor="debut">Du</label><input className="input" id="debut" name="debut" type="date" defaultValue={from}/></div><div className="field"><label htmlFor="fin">Au</label><input className="input" id="fin" name="fin" type="date" defaultValue={to}/></div><Select name="justificatif" label="Justificatif" value={p.justificatif as string} entries={{ avec: "Avec", sans: "Sans" }}/><div className="field filter-search"><label htmlFor="recherche">Recherche</label><input className="input" id="recherche" name="recherche" defaultValue={search}/></div><button className="secondary-link" type="submit">Filtrer</button></form>
    {filtered.length === 0 ? <EmptyState title={expenses.length ? "Aucune dépense ne correspond aux filtres" : "Aucune dépense"} description="Créez un brouillon pour commencer le suivi."/> : <div className="register-table-wrap compact-table-wrap expense-table-wrap"><table className="register-table compact-table expense-table"><thead><tr><th>Référence</th><th>Date</th><th>Fournisseur</th><th>Description</th><th>Catégorie</th><th>Statut</th><th>Montant</th><th>Payé</th><th>Remboursé</th><th>Reste</th><th>Justificatifs</th></tr></thead><tbody>{filtered.map((expense) => { const financials = calculateExpenseFinancials(expense); const supplier = expense.suppliers?.name ?? "Sans fournisseur"; const documentCount = expense.expense_documents.length; return <tr key={expense.id}><td className="compact-primary-cell expense-main"><Link className="compact-primary-link" href={`/depenses/${expense.id}`}>{expense.reference}</Link></td><td className="expense-date">{formatFrenchDate(expense.purchased_on)}</td><td className="expense-supplier">{supplier}</td><td className="compact-description expense-description">{expense.description}</td><td className="expense-category">{expenseCategoryLabels[expense.category]}</td><td className="expense-status-cell"><ExpenseStatusBadge status={expense.status}/></td><td className="compact-amount expense-total">{formatEuroCents(expense.total_amount_cents)}</td><td className="compact-amount expense-paid">{formatEuroCents(financials.grossPaidCents)}</td><td className="compact-amount expense-refunded">{formatEuroCents(financials.grossRefundedCents)}</td><td className="compact-amount expense-remaining">{formatEuroCents(financials.remainingCents)}</td><td className="expense-documents"><span className={documentCount === 0 ? "compact-count compact-count-empty" : "compact-count"}>{documentCount}</span></td><td className="compact-mobile-context expense-mobile-context">{formatFrenchDate(expense.purchased_on)} · {supplier} · {expenseCategoryLabels[expense.category]} · {expense.description}</td><td className="compact-mobile-financials expense-mobile-financials">Payé {formatEuroCents(financials.grossPaidCents)} · Remb. {formatEuroCents(financials.grossRefundedCents)} · Reste {formatEuroCents(financials.remainingCents)} · Justif. {documentCount}</td></tr>; })}</tbody></table></div>}
  </>;
}

function Select({ name, label, value, entries }: { name: string; label: string; value?: string; entries: Record<string, string> }) {
  return <div className="field"><label htmlFor={name}>{label}</label><select className="input" id={name} name={name} defaultValue={value ?? ""}><option value="">Tous</option>{Object.entries(entries).map(([key, itemLabel]) => <option value={key} key={key}>{itemLabel}</option>)}</select></div>;
}
