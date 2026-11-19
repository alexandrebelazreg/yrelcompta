import { ConfirmSubmitButton } from "@/components/sales/confirm-submit-button";
import { formatIndicativeUnitCost, formatMilliunits } from "@/lib/products/calculations";
import { materialUnitLabels } from "@/lib/products/labels";
import { deleteMaterialPurchaseAction, toggleMaterialPurchaseExclusionAction } from "@/lib/products/purchase-actions";
import { pickReferencePurchase, purchaseSourceLabels, type MaterialPurchase } from "@/lib/products/purchases";
import { formatEuroCents } from "@/lib/sales/calculations";
import { formatFrenchDate } from "@/lib/utils/format";
import type { Supplier } from "@/types/expenses";
import type { Material } from "@/types/products";
import { MaterialPurchaseForm } from "./material-purchase-form";

/**
 * Historique d'achats d'une matière : le coût de la fiche est celui de l'achat compté au coût
 * unitaire le plus élevé (marqué « Retenu »). Chaque achat peut être exclu du calcul ou supprimé.
 */
export function MaterialPurchaseHistory({ material, purchases, suppliers, today }: { material: Material; purchases: MaterialPurchase[]; suppliers: Supplier[]; today: string }) {
  const reference = pickReferencePurchase(purchases);
  const unit = materialUnitLabels[material.unit];
  return <section className="material-purchases">
    <div className="section-heading">
      <h3>Historique d’achats</h3>
      {reference && <p className="compact-secondary-text">Coût retenu : {formatIndicativeUnitCost(reference.total_cost_cents, reference.quantity_milliunits)} € / {unit} (achat compté le plus cher)</p>}
    </div>
    {purchases.length === 0 ? <p className="history-empty">Aucun achat enregistré.</p> : <ul className="material-purchase-list">
      {purchases.map((purchase) => {
        const isReference = purchase.id === reference?.id;
        return <li key={purchase.id} className={`material-purchase${purchase.excluded ? " is-excluded" : ""}`}>
          <div className="material-purchase-main">
            <strong>{formatFrenchDate(purchase.purchased_on)} · {purchase.suppliers?.name ?? "Fournisseur non renseigné"}</strong>
            <span>Quantité {formatMilliunits(purchase.quantity_milliunits)} · {formatEuroCents(purchase.total_cost_cents)} frais compris · {formatIndicativeUnitCost(purchase.total_cost_cents, purchase.quantity_milliunits)} € / {unit}{purchase.order_reference ? ` · commande ${purchase.order_reference}` : ""}{purchase.expenses ? ` · dépense ${purchase.expenses.reference}` : ""}</span>
            <span className="material-purchase-badges">
              {isReference && <span className="management-status management-status-active">Retenu</span>}
              {purchase.excluded && <span className="management-status management-status-archived">Exclu du calcul</span>}
              {purchase.source === "sheet" && <span className="management-status">{purchaseSourceLabels.sheet}</span>}
            </span>
          </div>
          <div className="material-purchase-actions">
            <form action={toggleMaterialPurchaseExclusionAction}>
              <input type="hidden" name="purchaseId" value={purchase.id}/>
              <button className="table-action-link" type="submit">{purchase.excluded ? "Compter" : "Exclure"}</button>
            </form>
            <form action={deleteMaterialPurchaseAction}>
              <input type="hidden" name="purchaseId" value={purchase.id}/>
              <ConfirmSubmitButton danger message="Supprimer définitivement cet achat de l’historique ?">Supprimer</ConfirmSubmitButton>
            </form>
          </div>
        </li>;
      })}
    </ul>}
    <details className="action-panel"><summary className="secondary-link">Ajouter un achat</summary><MaterialPurchaseForm materialId={material.id} unitLabel={unit} suppliers={suppliers} today={today}/></details>
  </section>;
}
