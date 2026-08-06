import { createElement, Fragment, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SaleItem } from "../../types/sales";
import { SaleItemManufacturingDetails, SaleManufacturingCostSummary } from "./manufacturing-cost-display";

const historicalMessage = "Aucun coût historique n’a été reconstitué pour cette vente. Cette vente a été validée avant l’activation des snapshots de coût.";
const incompleteMessage = "Marge totale indisponible : au moins une ligne ne possède pas de coût de fabrication historique.";

function item(overrides: Partial<SaleItem> = {}): SaleItem {
  return {
    id: "item-1",
    description: "Création",
    quantity: 1,
    unit_price_cents: 2500,
    line_total_cents: 2500,
    product_id: null,
    product_name_snapshot: null,
    product_sku_snapshot: null,
    unit_raw_materials_cost_cents: null,
    unit_material_loss_cost_cents: null,
    unit_labor_cost_cents: null,
    unit_packaging_cost_cents: null,
    unit_manufacturing_cost_cents: null,
    line_manufacturing_cost_cents: null,
    line_margin_before_discount_cents: null,
    position: 1,
    product: null,
    ...overrides,
  };
}

type SummarySale = ComponentProps<typeof SaleManufacturingCostSummary>["sale"];
const historicalSale: SummarySale = { status: "validated", costing_evaluated: false, costing_complete: false, subtotal_cents: 2500, discount_cents: 0, manufacturing_cost_cents: null, manufacturing_margin_cents: null };
const incompleteSale = { ...historicalSale, costing_evaluated: true };
const completeSale = { ...historicalSale, costing_evaluated: true, costing_complete: true, manufacturing_cost_cents: 1000, manufacturing_margin_cents: 1500 };
const details = (sale: SummarySale, saleItem: SaleItem): ReactNode => createElement(SaleItemManufacturingDetails, { sale, item: saleItem });
const summary = (sale: SummarySale): ReactNode => createElement(SaleManufacturingCostSummary, { sale });
const render = (...children: ReactNode[]) => renderToStaticMarkup(createElement(Fragment, null, ...children));

describe("rendu des trois états de coût", () => {
  it("présente une ancienne vente comme non évaluée sans prétendre que sa ligne était libre", () => {
    const html = render(details(historicalSale, item()), summary(historicalSale));
    expect(html).toContain(historicalMessage);
    expect(html).toContain("Coût historique non reconstitué");
    expect(html).not.toContain("Saisie libre");
    expect(html).not.toContain(incompleteMessage);
  });

  it("présente une vente entièrement libre évaluée comme incomplète et jamais comme historique", () => {
    const html = render(details(incompleteSale, item()), summary(incompleteSale));
    expect(html).toContain("Saisie libre");
    expect(html).toContain("Coût de fabrication non renseigné");
    expect(html).toContain(incompleteMessage);
    expect(html).not.toContain(historicalMessage);
  });

  it("présente séparément la ligne produit et la ligne libre d'une vente mixte", () => {
    const productItem = item({ product_id: "product-1", product_name_snapshot: "Bague figée", product_sku_snapshot: "BAG-01", unit_manufacturing_cost_cents: 800, line_manufacturing_cost_cents: 800, line_margin_before_discount_cents: 1700 });
    const html = render(details(incompleteSale, productItem), details(incompleteSale, item({ id: "item-2" })), summary(incompleteSale));
    expect(html).toContain("Produit figé : Bague figée · BAG-01");
    expect(html).toContain("Coût unitaire historique : 8,00 €");
    expect(html).toContain("Saisie libre");
    expect(html).toContain(incompleteMessage);
  });

  it("présente le coût et la marge d'une vente évaluée complète", () => {
    const html = render(summary(completeSale));
    expect(html).toContain("Coût de fabrication historique total");
    expect(html).toContain("10,00 €");
    expect(html).toContain("15,00 €");
    expect(html).not.toContain(incompleteMessage);
    expect(html).not.toContain(historicalMessage);
  });
});
