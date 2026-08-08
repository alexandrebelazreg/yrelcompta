import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { listProducts } from "@/lib/products/queries";
import { productCategoryLabels } from "@/lib/products/labels";
import { formatEuroCents } from "@/lib/sales/calculations";
import type { ProductCategory } from "@/types/products";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const category = typeof q.categorie === "string" && q.categorie in productCategoryLabels ? q.categorie as ProductCategory : undefined;
  const active = q.etat === "archives" ? "archived" : q.etat === "actifs" ? "active" : undefined;
  const search = typeof q.recherche === "string" ? q.recherche : undefined;
  const products = await listProducts(context.business.id, { category, active, search });

  return <>
    <header className="page-header"><div className="info-line"><h1>Produits</h1><InfoTip label="À propos des coûts produits">Estimez le coût de fabrication courant de vos bijoux.</InfoTip></div><div className="header-actions"><Link className="secondary-link" href="/produits/matieres">Matières</Link><Link className="secondary-link" href="/produits/parametres-cout">Paramètres de coût</Link><Link className="button-link" href="/produits/nouveau">Nouveau produit</Link></div></header>
    <form className="sales-filters"><div className="field filter-search"><label htmlFor="recherche">Nom ou SKU</label><input className="input" id="recherche" name="recherche" defaultValue={search}/></div><div className="field"><label htmlFor="categorie">Catégorie</label><select className="input" id="categorie" name="categorie" defaultValue={category ?? ""}><option value="">Toutes</option>{Object.entries(productCategoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="field"><label htmlFor="etat">État</label><select className="input" id="etat" name="etat" defaultValue={q.etat as string ?? ""}><option value="">Tous</option><option value="actifs">Actifs</option><option value="archives">Archivés</option></select></div><button className="secondary-link">Filtrer</button></form>
    {products.length === 0 ? <EmptyState title="Aucun produit" description="Créez votre premier bijou et sa recette de fabrication."/> : <div className="register-table-wrap compact-table-wrap product-table-wrap"><table className="register-table compact-table product-table"><thead><tr><th>Produit</th><th>SKU</th><th>Catégorie</th><th>État</th><th>Prix de vente</th><th>Coût de fabrication</th><th>Marge estimée</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td className="compact-primary-cell product-main"><Link className="compact-primary-link" href={`/produits/${product.id}`}>{product.name}</Link></td><td className="product-sku">{product.sku ?? "—"}</td><td className="product-category">{productCategoryLabels[product.category]}</td><td className="product-status-cell"><span className={`product-status product-status-${product.is_active ? "active" : "archived"}`}>{product.is_active ? "Actif" : "Archivé"}</span></td><td className="compact-amount product-price">{formatEuroCents(product.sale_price_cents)}</td><td className="compact-amount product-cost">{formatEuroCents(product.costing.manufacturingCostCents)}</td><td className="compact-amount product-margin">{formatEuroCents(product.costing.grossMarginCents)}</td><td className="compact-mobile-context product-mobile-context">{product.sku ?? "Sans SKU"} · {productCategoryLabels[product.category]}</td><td className="compact-mobile-financials product-mobile-financials">Coût {formatEuroCents(product.costing.manufacturingCostCents)} · Marge {formatEuroCents(product.costing.grossMarginCents)}</td></tr>)}</tbody></table></div>}
  </>;
}
