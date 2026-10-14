import Link from "next/link";
import { MaterialCategoryForm } from "@/components/products/material-category-form";
import { MaterialForm } from "@/components/products/material-form";
import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { archiveMaterialAction } from "@/lib/products/actions";
import { listMaterialCategories, listMaterials } from "@/lib/products/queries";
import { listSuppliers } from "@/lib/expenses/queries";
import { formatIndicativeUnitCost, formatMilliunits } from "@/lib/products/calculations";
import { defaultMaterialColors, materialUnitLabels, mergeLabelOptions } from "@/lib/products/labels";
import { formatEuroCents } from "@/lib/sales/calculations";

const WITHOUT_CATEGORY = "sans";
const messages: Record<string, string> = { categorie: "Catégorie enregistrée.", archivee: "Matière archivée." };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const [allMaterials, suppliers, categories] = await Promise.all([listMaterials(context.business.id), listSuppliers(context.business.id), listMaterialCategories(context.business.id)]);
  const colors = mergeLabelOptions(defaultMaterialColors, allMaterials.map((material) => material.color));
  const references = allMaterials.map((material) => material.internal_reference);
  const selectedCategory = typeof q.categorie === "string" && (q.categorie === WITHOUT_CATEGORY || categories.some((category) => category.id === q.categorie)) ? q.categorie : "";
  // Tri par catégorie (sans catégorie en dernier), puis matières actives d’abord, puis nom.
  const materials = allMaterials
    .filter((material) => !selectedCategory || (selectedCategory === WITHOUT_CATEGORY ? material.category_id === null : material.category_id === selectedCategory))
    .sort((a, b) => {
      const categoryA = a.material_categories?.name;
      const categoryB = b.material_categories?.name;
      if (categoryA !== categoryB) return categoryA === undefined ? 1 : categoryB === undefined ? -1 : categoryA.localeCompare(categoryB, "fr");
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.name.localeCompare(b.name, "fr");
    });
  const message = typeof q.message === "string" ? messages[q.message] ?? "Matière enregistrée." : undefined;

  return <>
    <Link className="back-link" href="/produits">← Produits</Link>
    <header className="page-header"><div className="info-line"><h1>Matières et composants</h1><InfoTip label="À propos des quantités de matières">Les quantités sont enregistrées en millièmes de l’unité choisie.</InfoTip></div></header>
    {message && <p className="form-message success">{message}</p>}
    {q.erreur && <p className="form-message">{String(q.erreur)}</p>}
    <div className="material-panels">
      <details className="action-panel"><summary className="button">Nouvelle matière</summary><MaterialForm suppliers={suppliers} colors={colors} categories={categories} references={references}/></details>
      {categories.length > 0 && <details className="action-panel"><summary className="secondary-link">Catégories ({categories.length})</summary><div className="material-category-list"><p className="compact-secondary-text">Changer un préfixe ne renomme pas les références déjà attribuées.</p>{categories.map((category) => <MaterialCategoryForm key={category.id} category={category}/>)}</div></details>}
    </div>
    <form className="sales-filters material-filters"><div className="field"><label htmlFor="categorie">Catégorie</label><select className="input" id="categorie" name="categorie" defaultValue={selectedCategory}><option value="">Toutes</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value={WITHOUT_CATEGORY}>Sans catégorie</option></select></div><button className="secondary-link">Filtrer</button></form>
    <div className="register-table-wrap compact-table-wrap material-table-wrap"><table className="register-table compact-table management-table material-table"><thead><tr><th>Matière</th><th>Catégorie</th><th>Couleur</th><th>Référence</th><th>Unité</th><th>Quantité du lot</th><th>Coût du lot</th><th>Coût indicatif / unité</th><th>Fournisseur</th><th>État</th><th>Actions</th></tr></thead><tbody>{materials.map((material) => { const supplierName = material.suppliers?.name ?? "Non renseigné"; const categoryName = material.material_categories?.name; const indicativeUnitCost = `${formatIndicativeUnitCost(material.package_cost_cents, material.package_quantity_milliunits)} €`; return <tr key={material.id}><td className="compact-primary-cell material-main"><strong>{material.name}</strong></td><td className="material-category">{categoryName ?? "—"}</td><td className="material-color">{material.color ?? "—"}</td><td className="material-reference">{material.internal_reference ?? "—"}</td><td className="material-unit">{materialUnitLabels[material.unit]}</td><td className="compact-amount material-quantity">{formatMilliunits(material.package_quantity_milliunits)}</td><td className="compact-amount material-cost">{formatEuroCents(material.package_cost_cents)}</td><td className="compact-amount material-unit-cost">{indicativeUnitCost}</td><td className="material-supplier">{supplierName}</td><td className="material-status-cell"><span className={`management-status management-status-${material.is_active ? "active" : "archived"}`}>{material.is_active ? "Active" : "Archivée"}</span></td><td className="compact-actions management-actions material-actions"><details className="table-action-details"><summary className="table-action-link">Modifier</summary><div className="table-action-form"><MaterialForm material={material} suppliers={suppliers} colors={colors} categories={categories} references={references}/></div></details>{material.is_active && <form action={archiveMaterialAction} className="table-inline-form"><input type="hidden" name="materialId" value={material.id}/><ConfirmSubmitButton danger message="Archiver cette matière ? Les recettes existantes resteront lisibles.">Archiver</ConfirmSubmitButton></form>}</td><td className="compact-mobile-context material-mobile-context">{categoryName ? `${categoryName} · ` : ""}{material.color ? `${material.color} · ` : ""}{material.internal_reference ?? "Sans référence"} · {materialUnitLabels[material.unit]} · {supplierName}</td><td className="compact-mobile-financials material-mobile-financials">Lot {formatMilliunits(material.package_quantity_milliunits)} · {indicativeUnitCost} / unité</td></tr>; })}</tbody></table></div>
    {materials.length === 0 && <p className="history-empty">Aucune matière dans cette catégorie.</p>}
  </>;
}
