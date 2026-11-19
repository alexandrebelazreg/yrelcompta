import "server-only";
import { z } from "zod";
import { getExpense, listExpenses, listSuppliers } from "@/lib/expenses/queries";
import { formatIndicativeUnitCost, formatMilliunits } from "@/lib/products/calculations";
import { materialUnitLabels } from "@/lib/products/labels";
import { listMaterialPurchases } from "@/lib/products/purchase-queries";
import { materialPurchaseSchema, pickReferencePurchase, purchaseErrorMessage, purchaseSourceLabels, type MaterialPurchase } from "@/lib/products/purchases";
import { listMaterials } from "@/lib/products/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import type { Material } from "@/types/products";
import type { McpToolContext } from "./auth";
import { findAnyMaterial } from "./material-photo-tools";
import { McpToolError, type McpTool } from "./protocol";

const lower = (value: string) => value.trim().toLocaleLowerCase("fr");
const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${label} au format AAAA-MM-JJ.`);
const quantity = z.union([z.string().trim().max(20), z.number().positive()]).transform(String).describe("Quantité achetée, dans l’unité de la matière (pièces, cm, g ou ml), jusqu’à 3 décimales.");
const totalCost = z.union([z.string().trim().max(20), z.number().positive()]).transform(String).describe("Coût total TTC de cette matière pour cet achat, frais de port compris (la part des frais d’une commande groupée est à répartir avant l’envoi), en euros, ex. \"12,50\".");
const supplier = z.string().trim().max(160).describe("Nom du fournisseur ; créé s’il n’existe pas encore.");
const orderReference = z.string().trim().max(200).describe("Numéro de commande du fournisseur.");
const expense = z.string().trim().max(80).describe("Dépense liée : identifiant ou référence (ex. DEP-2026-0042).");
const confirmation = z.literal(true).describe("Action définitive : true UNIQUEMENT après accord explicite de l’utilisatrice pour cette suppression précise.");

function describePurchase(purchase: MaterialPurchase, material: Material | undefined, referenceId: string | undefined) {
  const unit = material ? materialUnitLabels[material.unit] : "";
  return {
    id: purchase.id,
    matiere: material?.name ?? purchase.material_id,
    reference_matiere: material?.internal_reference ?? null,
    date: purchase.purchased_on,
    fournisseur: purchase.suppliers?.name ?? null,
    numero_commande: purchase.order_reference,
    quantite: `${formatMilliunits(purchase.quantity_milliunits)} ${unit}`.trim(),
    cout_total: formatEuroCents(purchase.total_cost_cents),
    cout_unitaire: `${formatIndicativeUnitCost(purchase.total_cost_cents, purchase.quantity_milliunits)} €`,
    exclu: purchase.excluded,
    origine: purchaseSourceLabels[purchase.source],
    depense: purchase.expenses?.reference ?? null,
    retenu: purchase.id === referenceId,
  };
}

/** Coût unitaire retenu après une écriture, pour que Claude puisse le confirmer à l'utilisatrice. */
async function retainedCost(businessId: string, material: Material) {
  const reference = pickReferencePurchase(await listMaterialPurchases(businessId, material.id));
  return reference ? `${formatIndicativeUnitCost(reference.total_cost_cents, reference.quantity_milliunits)} € / ${materialUnitLabels[material.unit]}` : null;
}

async function resolveSupplier(businessId: string, name: string | undefined, current: string | null): Promise<{ supplierId: string; newSupplierName: string }> {
  if (name === undefined) return { supplierId: current ?? "", newSupplierName: "" };
  if (name === "") return { supplierId: "", newSupplierName: "" };
  const existing = (await listSuppliers(businessId)).find((candidate) => candidate.is_active && lower(candidate.name) === lower(name));
  return existing ? { supplierId: existing.id, newSupplierName: "" } : { supplierId: "", newSupplierName: name };
}

async function resolveExpenseId(businessId: string, key: string | undefined, current: string | null): Promise<string> {
  if (key === undefined) return current ?? "";
  if (key === "") return "";
  const id = z.string().uuid().safeParse(key).success ? key : (await listExpenses(businessId, { search: key })).find((candidate) => lower(candidate.reference) === lower(key))?.id;
  const found = id ? await getExpense(businessId, id) : null;
  if (!found || found.status === "cancelled") throw new McpToolError(`Aucune dépense active ne correspond à « ${key} ». Consultez list_expenses.`);
  return found.id;
}

function parsePurchase(value: unknown) {
  const parsed = materialPurchaseSchema.safeParse(value);
  if (!parsed.success) throw new McpToolError(`Données invalides : ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "entrée"} — ${issue.message}`).join(" ; ")}`);
  return parsed.data;
}

async function findPurchase(businessId: string, purchaseId: string): Promise<MaterialPurchase> {
  const purchase = (await listMaterialPurchases(businessId)).find((candidate) => candidate.id === purchaseId);
  if (!purchase) throw new McpToolError("Aucun achat ne correspond à cet identifiant. Consultez list_material_purchases.");
  return purchase;
}

async function rpc(context: McpToolContext, name: string, args: Record<string, unknown>) {
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) {
    console.error("Historique d’achats refusé", { code: error.code });
    throw new McpToolError(purchaseErrorMessage(error.code, error.message));
  }
  return data;
}

export const materialPurchaseTools: McpTool<McpToolContext>[] = [
  {
    name: "list_material_purchases",
    title: "Historique d’achats des matières",
    description: "Liste les achats d’une matière (ou de toutes) : date, fournisseur, n° de commande, quantité, coût total frais compris, coût unitaire, exclusion du calcul et origine. « Reprise de la fiche » désigne le lot repris de l’ancienne fiche, à remplacer par les vrais achats. L’achat « retenu » (compté, coût unitaire le plus élevé) fixe le coût de la matière.",
    input: z.object({ material: z.string().trim().min(1).max(160).optional().describe("Identifiant, référence ou nom exact de la matière ; toutes si absent.") }),
    run: async (input, { businessId }) => {
      const key = (input as { material?: string }).material;
      const materials = await listMaterials(businessId);
      const target = key ? findAnyMaterial(materials, key) : undefined;
      const purchases = await listMaterialPurchases(businessId, target?.id);
      const byId = new Map(materials.map((material) => [material.id, material]));
      const referenceIds = new Map<string, string | undefined>();
      for (const materialId of new Set(purchases.map((purchase) => purchase.material_id))) referenceIds.set(materialId, pickReferencePurchase(purchases.filter((purchase) => purchase.material_id === materialId))?.id);
      return purchases.slice(0, 500).map((purchase) => describePurchase(purchase, byId.get(purchase.material_id), referenceIds.get(purchase.material_id)));
    },
  },
  {
    name: "add_material_purchase",
    kind: "write",
    title: "Ajouter un achat de matière",
    description: "Ajoute un achat à l’historique d’une matière (active ou archivée). Le coût de la matière devient automatiquement le coût unitaire le plus élevé parmi les achats comptés. Pour remplacer une « reprise de la fiche », ajoutez d’abord les vrais achats puis supprimez la reprise.",
    input: z.object({
      material: z.string().trim().min(1).max(160).describe("Identifiant, référence ou nom exact de la matière."),
      purchased_on: isoDate("Date d’achat"),
      quantity,
      total_cost: totalCost,
      supplier: supplier.optional(),
      order_reference: orderReference.optional(),
      expense: expense.optional(),
      excluded: z.boolean().default(false).describe("Vrai pour enregistrer l’achat sans le compter dans le coût."),
    }),
    run: async (input, context) => {
      const data = input as { material: string; purchased_on: string; quantity: string; total_cost: string; supplier?: string; order_reference?: string; expense?: string; excluded: boolean };
      const material = findAnyMaterial(await listMaterials(context.businessId), data.material);
      const { supplierId, newSupplierName } = await resolveSupplier(context.businessId, data.supplier, null);
      const expenseId = await resolveExpenseId(context.businessId, data.expense, null);
      const p = parsePurchase({ purchasedOn: data.purchased_on, quantity: data.quantity, totalCost: data.total_cost, supplierId, newSupplierName, orderReference: data.order_reference ?? "", expenseId, excluded: data.excluded });
      const id = await rpc(context, "add_material_purchase", { p_business_id: context.businessId, p_material_id: material.id, p_purchased_on: p.purchasedOn, p_supplier_id: p.supplierId || null, p_new_supplier_name: p.newSupplierName || null, p_order_reference: p.orderReference || null, p_quantity_milliunits: p.quantity, p_total_cost_cents: p.totalCost, p_expense_id: p.expenseId || null, p_excluded: p.excluded });
      return { ajoute: true, id: String(id), matiere: material.name, nouveau_fournisseur: Boolean(p.newSupplierName), cout_unitaire_retenu: await retainedCost(context.businessId, material) };
    },
  },
  {
    name: "update_material_purchase",
    kind: "write",
    title: "Modifier un achat de matière",
    description: "Corrige un achat de l’historique (seuls les champs fournis changent) : quantité, coût, date, fournisseur, n° de commande, dépense liée, ou exclusion du calcul (excluded). Une matière garde toujours au moins un achat compté.",
    input: z.object({
      purchase: z.string().uuid().describe("Identifiant de l’achat (voir list_material_purchases)."),
      purchased_on: isoDate("Date d’achat").optional(),
      quantity: quantity.optional(),
      total_cost: totalCost.optional(),
      supplier: supplier.optional().describe("Nom du fournisseur ; chaîne vide pour le retirer."),
      order_reference: orderReference.optional().describe("Numéro de commande ; chaîne vide pour le retirer."),
      expense: expense.optional().describe("Dépense liée ; chaîne vide pour retirer le lien."),
      excluded: z.boolean().optional().describe("Vrai pour exclure l’achat du calcul du coût, faux pour le compter."),
    }),
    run: async (input, context) => {
      const data = input as { purchase: string; purchased_on?: string; quantity?: string; total_cost?: string; supplier?: string; order_reference?: string; expense?: string; excluded?: boolean };
      const current = await findPurchase(context.businessId, data.purchase);
      const material = findAnyMaterial(await listMaterials(context.businessId), current.material_id);
      const { supplierId, newSupplierName } = await resolveSupplier(context.businessId, data.supplier, current.supplier_id);
      const expenseId = await resolveExpenseId(context.businessId, data.expense, current.expense_id);
      const p = parsePurchase({
        purchasedOn: data.purchased_on ?? current.purchased_on,
        quantity: data.quantity ?? String(current.quantity_milliunits / 1000),
        totalCost: data.total_cost ?? (current.total_cost_cents / 100).toFixed(2),
        supplierId, newSupplierName,
        orderReference: data.order_reference ?? current.order_reference ?? "",
        expenseId,
        excluded: data.excluded ?? current.excluded,
      });
      await rpc(context, "update_material_purchase", { p_purchase_id: current.id, p_business_id: context.businessId, p_purchased_on: p.purchasedOn, p_supplier_id: p.supplierId || null, p_new_supplier_name: p.newSupplierName || null, p_order_reference: p.orderReference || null, p_quantity_milliunits: p.quantity, p_total_cost_cents: p.totalCost, p_expense_id: p.expenseId || null, p_excluded: p.excluded });
      return { modifie: true, id: current.id, matiere: material.name, exclu: p.excluded, cout_unitaire_retenu: await retainedCost(context.businessId, material) };
    },
  },
  {
    name: "delete_material_purchase",
    kind: "destructive",
    title: "Supprimer un achat de matière",
    description: "Supprime définitivement un achat de l’historique (par exemple une « reprise de la fiche » une fois les vrais achats ajoutés). Refusé s’il s’agit du dernier achat compté de la matière.",
    input: z.object({ purchase: z.string().uuid().describe("Identifiant de l’achat (voir list_material_purchases)."), confirmation }),
    run: async (input, context) => {
      const current = await findPurchase(context.businessId, (input as { purchase: string }).purchase);
      const material = findAnyMaterial(await listMaterials(context.businessId), current.material_id);
      await rpc(context, "delete_material_purchase", { p_purchase_id: current.id, p_business_id: context.businessId });
      return { supprime: true, matiere: material.name, cout_unitaire_retenu: await retainedCost(context.businessId, material) };
    },
  },
];
