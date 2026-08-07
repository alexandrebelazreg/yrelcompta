import { calculateManufacturingMarginRate, formatEuroCents, getSaleCostingState } from "../../lib/sales/calculations";
import type { Sale, SaleItem } from "../../types/sales";

type CostingStateSale = Pick<Sale, "status" | "costing_evaluated" | "costing_complete">;
type CostingSummarySale = CostingStateSale & Pick<Sale, "subtotal_cents" | "discount_cents" | "manufacturing_cost_cents" | "manufacturing_margin_cents">;

export function SaleItemManufacturingDetails({ sale, item }: { sale: CostingStateSale; item: SaleItem }) {
  const state = getSaleCostingState(sale);

  if (state === "historical-unassessed") return <span>Coût historique non reconstitué</span>;
  if (state === "draft" && item.product_id) return <><span>Produit lié : {item.product?.name ?? "Produit introuvable"}{item.product?.sku ? ` · ${item.product.sku}` : ""}</span><span>Coût figé à la validation</span></>;
  if (state === "draft" || item.product_id === null) return <><span>Saisie libre</span><span>Coût de fabrication non renseigné</span></>;
  if (item.unit_manufacturing_cost_cents === null || item.line_manufacturing_cost_cents === null || item.line_margin_before_discount_cents === null) return <span>Données de snapshot incohérentes</span>;

  return <>
    <span>Produit figé : {item.product_name_snapshot}{item.product_sku_snapshot ? ` · ${item.product_sku_snapshot}` : ""}</span>
    <span>Coût unitaire historique : {formatEuroCents(item.unit_manufacturing_cost_cents)}</span>
    <span>Coût total historique : {formatEuroCents(item.line_manufacturing_cost_cents)}</span>
    <span>Marge de ligne avant remise globale : {formatEuroCents(item.line_margin_before_discount_cents)}</span>
  </>;
}

export function SaleManufacturingCostSummary({ sale }: { sale: CostingSummarySale }) {
  const state = getSaleCostingState(sale);
  if (state === "draft") return null;

  if (state === "historical-unassessed") return <aside className="manufacturing-summary"><p><strong>Aucun coût historique n’a été reconstitué pour cette vente. Cette vente a été validée avant l’activation des snapshots de coût.</strong></p></aside>;

  if (state === "evaluated-incomplete") return <aside className="manufacturing-summary"><p><strong>Marge totale indisponible : au moins une ligne ne possède pas de coût de fabrication historique.</strong></p></aside>;

  if (sale.manufacturing_cost_cents === null || sale.manufacturing_margin_cents === null) return <aside className="manufacturing-summary"><p><strong>Données de coût historique incohérentes.</strong></p></aside>;
  const marginRate = calculateManufacturingMarginRate(sale.subtotal_cents, sale.discount_cents, sale.manufacturing_margin_cents);
  return <aside className="manufacturing-summary"><h3>Coût et marge historiques</h3><dl className="detail-list"><div><dt>Coût de fabrication historique total</dt><dd>{formatEuroCents(sale.manufacturing_cost_cents)}</dd></div><div><dt>Marge de fabrication après remise, avant frais commerciaux, cotisations et fiscalité</dt><dd>{formatEuroCents(sale.manufacturing_margin_cents)}</dd></div>{marginRate !== null && <div><dt>Taux de marge sur les marchandises après remise</dt><dd>{marginRate.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %</dd></div>}</dl><p className="field-help">Cette marge exclut les frais de livraison, les commissions de paiement et de plateforme, les remboursements, les cotisations sociales, la TVA et l’impôt.</p></aside>;
}
