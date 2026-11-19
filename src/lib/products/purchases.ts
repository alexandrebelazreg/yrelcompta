/**
 * Historique d'achats des matières. Module partagé (serveur et navigateur) : types, validation et
 * règle de calcul. Le coût unitaire d'une matière est celui de l'achat COMPTÉ (non exclu) au coût
 * unitaire le plus élevé — ni le dernier, ni la moyenne. La base applique la même règle
 * (refresh_material_reference_lot) pour tenir à jour le lot de la fiche.
 */
import { z } from "zod";
import { parseFrenchMoneyToCents } from "@/lib/sales/calculations";
import { parseQuantityToMilliunits } from "./validation";

export type MaterialPurchaseSource = "purchase" | "sheet";

export interface MaterialPurchase {
  id: string;
  material_id: string;
  purchased_on: string;
  supplier_id: string | null;
  suppliers: { name: string } | null;
  order_reference: string | null;
  quantity_milliunits: number;
  total_cost_cents: number;
  expense_id: string | null;
  expenses: { reference: string } | null;
  excluded: boolean;
  source: MaterialPurchaseSource;
  created_at: string;
}

export const purchaseSourceLabels: Record<MaterialPurchaseSource, string> = { purchase: "Achat", sheet: "Reprise de la fiche" };

type Ranked = Pick<MaterialPurchase, "id" | "quantity_milliunits" | "total_cost_cents" | "excluded" | "purchased_on" | "created_at">;

/** Compare deux coûts unitaires exactement (produits en croisé, sans division). */
function compareUnitCost(a: Ranked, b: Ranked): number {
  const left = BigInt(a.total_cost_cents) * BigInt(b.quantity_milliunits);
  const right = BigInt(b.total_cost_cents) * BigInt(a.quantity_milliunits);
  return left === right ? 0 : left > right ? 1 : -1;
}

/** Achat qui fixe le coût de la matière : compté, coût unitaire maximal, puis le plus récent. */
export function pickReferencePurchase<T extends Ranked>(purchases: T[]): T | null {
  let best: T | null = null;
  for (const purchase of purchases) {
    if (purchase.excluded) continue;
    if (!best) { best = purchase; continue; }
    const order = compareUnitCost(purchase, best) || purchase.purchased_on.localeCompare(best.purchased_on) || purchase.created_at.localeCompare(best.created_at);
    if (order > 0) best = purchase;
  }
  return best;
}

const quantity = z.preprocess((value) => { try { return parseQuantityToMilliunits(String(value)); } catch { return Number.NaN; } }, z.number({ error: "Quantité invalide (jusqu’à 3 décimales)." }).int().positive().safe());
const money = z.preprocess((value) => { try { return parseFrenchMoneyToCents(String(value)); } catch { return Number.NaN; } }, z.number({ error: "Montant invalide." }).int().positive().max(9_000_000_000_000));
const optionalText = (max: number) => z.preprocess((value) => String(value ?? "").trim(), z.string().max(max));

export const materialPurchaseSchema = z.object({
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.").refine((value) => value >= "2000-01-01", "Date invalide."),
  quantity,
  totalCost: money,
  supplierId: z.string().uuid().or(z.literal("")),
  newSupplierName: optionalText(160),
  orderReference: optionalText(200),
  expenseId: z.string().uuid().or(z.literal("")),
  excluded: z.boolean().default(false),
});
export type MaterialPurchaseInput = z.infer<typeof materialPurchaseSchema>;

export const MATERIAL_LOT_FROM_PURCHASES_MESSAGE = "Le lot et le coût d’une matière viennent de son historique d’achats : ajoutez, corrigez ou excluez un achat au lieu de modifier la fiche.";
export const LAST_COUNTED_PURCHASE_MESSAGE = "Une matière doit garder au moins un achat compté : ajoutez d’abord l’achat réel, puis retirez ou excluez celui-ci.";

/** Traduit un refus de la base sur l'historique d'achats. */
export function purchaseErrorMessage(code?: string, detail?: string): string {
  if (detail === "at least one counted purchase required") return LAST_COUNTED_PURCHASE_MESSAGE;
  if (detail === "expense not found") return "La dépense liée est introuvable ou annulée.";
  if (detail === "ambiguous supplier") return "Choisissez un fournisseur existant ou créez-en un nouveau.";
  if (detail === "purchase not found" || detail === "material not found" || code === "P0002") return "L’élément demandé est introuvable.";
  if (code === "42501") return "Vous n’avez pas accès à cette entreprise.";
  return "L’achat a été refusé : vérifiez les informations saisies.";
}
