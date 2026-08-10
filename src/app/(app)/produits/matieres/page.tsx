import Link from "next/link";
import { MaterialForm } from "@/components/products/material-form";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { archiveMaterialAction } from "@/lib/products/actions";
import { listMaterials } from "@/lib/products/queries";
import { listSuppliers } from "@/lib/expenses/queries";
import { formatIndicativeUnitCost, formatMilliunits } from "@/lib/products/calculations";
import { materialUnitLabels } from "@/lib/products/labels";
import { formatEuroCents } from "@/lib/sales/calculations";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const [materials, suppliers] = await Promise.all([listMaterials(context.business.id), listSuppliers(context.business.id)]);

  return <>
    <Link className="back-link" href="/produits">← Produits</Link>
    <header className="page-header"><div className="info-line"><h1>Matières et composants</h1><InfoTip label="À propos des quantités de matières">Les quantités sont enregistrées en millièmes de l’unité choisie.</InfoTip></div></header>
    {q.message && <p className="form-message success">Matière enregistrée.</p>}
    {q.erreur && <p className="form-message">{String(q.erreur)}</p>}
    <details className="action-panel"><summary className="button">Nouvelle matière</summary><MaterialForm suppliers={suppliers}/></details>
    <div className="register-table-wrap compact-table-wrap material-table-wrap"><table className="register-table compact-table management-table material-table"><thead><tr><th>Matière</th><th>Référence</th><th>Unité</th><th>Quantité du lot</th><th>Coût du lot</th><th>Coût indicatif / unité</th><th>Fournisseur</th><th>État</th><th>Actions</th></tr></thead><tbody>{materials.map((material) => { const supplierName = material.suppliers?.name ?? "Non renseigné"; const indicativeUnitCost = `${formatIndicativeUnitCost(material.package_cost_cents, material.package_quantity_milliunits)} €`; return <tr key={material.id}><td className="compact-primary-cell material-main"><strong>{material.name}</strong></td><td className="material-reference">{material.internal_reference ?? "—"}</td><td className="material-unit">{materialUnitLabels[material.unit]}</td><td className="compact-amount material-quantity">{formatMilliunits(material.package_quantity_milliunits)}</td><td className="compact-amount material-cost">{formatEuroCents(material.package_cost_cents)}</td><td className="compact-amount material-unit-cost">{indicativeUnitCost}</td><td className="material-supplier">{supplierName}</td><td className="material-status-cell"><span className={`management-status management-status-${material.is_active ? "active" : "archived"}`}>{material.is_active ? "Active" : "Archivée"}</span></td><td className="compact-actions management-actions material-actions"><details className="table-action-details"><summary className="table-action-link">Modifier</summary><div className="table-action-form"><MaterialForm material={material} suppliers={suppliers}/></div></details>{material.is_active && <form action={archiveMaterialAction} className="table-inline-form"><input type="hidden" name="materialId" value={material.id}/><ConfirmSubmitButton danger message="Archiver cette matière ? Les recettes existantes resteront lisibles.">Archiver</ConfirmSubmitButton></form>}</td><td className="compact-mobile-context material-mobile-context">{material.internal_reference ?? "Sans référence"} · {materialUnitLabels[material.unit]} · {supplierName}</td><td className="compact-mobile-financials material-mobile-financials">Lot {formatMilliunits(material.package_quantity_milliunits)} · {indicativeUnitCost} / unité</td></tr>; })}</tbody></table></div>
  </>;
}
