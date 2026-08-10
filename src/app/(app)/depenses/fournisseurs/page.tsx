import Link from "next/link";
import { SupplierForm } from "@/components/expenses/supplier-form";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { InfoTip } from "@/components/ui/info-tip";
import { archiveSupplierAction } from "@/lib/expenses/actions";
import { getSupplierStats } from "@/lib/expenses/queries";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const search = typeof p.recherche === "string" ? p.recherche.trim().toLowerCase() : "";
  const rows = (await getSupplierStats(context.business.id)).filter((supplier) => !search || `${supplier.name} ${supplier.city ?? ""} ${supplier.email ?? ""} ${supplier.registration_number ?? ""}`.toLowerCase().includes(search));
  const error = typeof p.erreur === "string" ? p.erreur : undefined;
  const message = typeof p.message === "string" ? (p.message === "archive" ? "Le fournisseur a été archivé." : "Le fournisseur a été enregistré.") : undefined;

  return <>
    <Link className="back-link" href="/depenses">← Dépenses</Link>
    <header className="page-header"><div className="info-line"><h1>Fournisseurs</h1><InfoTip label="À propos de l’archivage des fournisseurs">Archivez un fournisseur au lieu de supprimer son historique.</InfoTip></div></header>
    {message && <p className="form-message success">{message}</p>}
    {error && <p className="form-message">{error}</p>}
    <form className="sales-filters"><div className="field filter-search"><label htmlFor="recherche">Nom, ville, e-mail ou immatriculation</label><input className="input" id="recherche" name="recherche" defaultValue={search}/></div><button className="secondary-link">Rechercher</button></form>
    <details className="action-panel"><summary className="button">Nouveau fournisseur</summary><SupplierForm/></details>
    <div className="register-table-wrap compact-table-wrap supplier-table-wrap"><table className="register-table compact-table management-table supplier-table"><thead><tr><th>Fournisseur</th><th>État</th><th>Dépenses</th><th>Total validé</th><th>Dernière dépense</th><th>Adresse</th><th>Immatriculation</th><th>Actions</th></tr></thead><tbody>{rows.map((supplier) => { const address = [supplier.address_line_1, supplier.address_line_2, [supplier.postal_code, supplier.city].filter(Boolean).join(" "), supplier.country_code].filter(Boolean).join(" · "); const lastExpense = supplier.lastExpense ? formatFrenchDate(supplier.lastExpense) : "Aucune"; return <tr key={supplier.id}><td className="compact-primary-cell supplier-main"><strong>{supplier.name}</strong></td><td className="supplier-status-cell"><span className={`management-status management-status-${supplier.is_active ? "active" : "archived"}`}>{supplier.is_active ? "Actif" : "Archivé"}</span></td><td className="supplier-expense-count">{supplier.expenseCount}</td><td className="compact-amount supplier-total">{formatEuroCents(supplier.validatedCents)}</td><td className="supplier-last-expense">{lastExpense}</td><td className="compact-description supplier-address">{address || "Non renseignée"}</td><td className="supplier-registration">{supplier.registration_number ?? "—"}</td><td className="compact-actions management-actions supplier-actions"><details className="table-action-details"><summary className="table-action-link">Modifier</summary><div className="table-action-form"><SupplierForm supplier={supplier}/></div></details>{supplier.is_active && <form action={archiveSupplierAction} className="table-inline-form"><input type="hidden" name="supplierId" value={supplier.id}/><ConfirmSubmitButton danger message="Archiver ce fournisseur ?">Archiver</ConfirmSubmitButton></form>}</td><td className="compact-mobile-context supplier-mobile-context">{supplier.expenseCount} dépense(s) · {address || "Adresse non renseignée"}</td><td className="compact-mobile-financials supplier-mobile-financials">Dernière {lastExpense} · Immat. {supplier.registration_number ?? "—"}</td></tr>; })}</tbody></table></div>
  </>;
}
