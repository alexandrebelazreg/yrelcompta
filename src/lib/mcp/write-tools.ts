import "server-only";
import { z } from "zod";
import { expenseCategoryLabels, expenseCostBehaviorLabels, expenseNatureLabels } from "@/lib/expenses/labels";
import { listSuppliers } from "@/lib/expenses/queries";
import { expenseCategories, expenseFormSchema, recurringSchema, supplierSchema } from "@/lib/expenses/validation";
import { MATERIAL_UNIT_IMMUTABLE_MESSAGE } from "@/lib/products/errors";
import { materialUnitLabels } from "@/lib/products/labels";
import { listMaterialCategories, listMaterials, listProducts } from "@/lib/products/queries";
import { suggestNextReference, suggestReferencePrefix } from "@/lib/products/references";
import { materialSchema, parseQuantityToMilliunits, productSchema } from "@/lib/products/validation";
import { formatEuroCents } from "@/lib/sales/calculations";
import { getTodayInParis } from "@/lib/utils/date";
import type { Material } from "@/types/products";
import type { Supplier } from "@/types/expenses";
import type { McpToolContext } from "./auth";
import { McpToolError, type McpTool } from "./protocol";

const lower = (value: string) => value.trim().toLocaleLowerCase("fr");
const amount = (label: string) => z.union([z.string().trim().max(20), z.number().nonnegative()]).transform(String).describe(`${label} en euros TTC, par exemple "12,50".`);
const quantity = (label: string) => z.union([z.string().trim().max(20), z.number().positive()]).transform(String).describe(`${label}, jusqu’à 3 décimales (ex. "1,5").`);
const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${label} au format AAAA-MM-JJ.`);
const listing = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => `${key} = ${label}`).join(", ");

const unit = z.enum(["piece", "gram", "centimeter", "milliliter"]).describe(`Unité de consommation : ${listing(materialUnitLabels)}.`);
const expenseCategory = z.enum(expenseCategories).describe(`Catégorie : ${listing(expenseCategoryLabels)}.`);
const nature = z.enum(["operating", "investment", "tax_social"]).describe(`Nature : ${listing(expenseNatureLabels)}. Le matériel durable est en général un investissement.`);
const costBehavior = z.enum(["fixed", "variable", "exceptional"]).describe(`Comportement : ${listing(expenseCostBehaviorLabels)}.`);
const professionalShare = z.number().min(0).max(100).describe("Part professionnelle suivie en interne, en pourcentage (100 par défaut). Ce n’est pas une déduction fiscale.");

/** Traduit le refus d'une RPC en message compréhensible, sans détail technique. */
function rpcFailure(label: string, error: { code?: string; message?: string }): never {
  console.error("Écriture du connecteur refusée", { label, code: error.code });
  if (error.message === "material unit is immutable once used") throw new McpToolError(MATERIAL_UNIT_IMMUTABLE_MESSAGE);
  if (error.code === "42501") throw new McpToolError("Accès refusé à cette entreprise.");
  if (error.code === "23505") throw new McpToolError("Cet élément existe déjà : un nom, une référence, un SKU ou un préfixe identique est déjà utilisé.");
  if (error.code === "P0002") throw new McpToolError("L’élément demandé est introuvable.");
  throw new McpToolError(`${label} a été refusé par YrelCompta : les données sont incohérentes.`);
}

function invalid(error: z.ZodError): never {
  throw new McpToolError(`Données invalides : ${error.issues.map((issue) => `${issue.path.join(".") || "entrée"} — ${issue.message}`).join(" ; ")}`);
}

function findSupplier(suppliers: Supplier[], name: string): Supplier | undefined {
  return suppliers.find((supplier) => supplier.is_active && lower(supplier.name) === lower(name));
}

function findMaterial(materials: Material[], key: string): Material {
  const needle = lower(key);
  const matches = materials.filter((material) => material.is_active && (material.id === key || lower(material.name) === needle || (material.internal_reference && lower(material.internal_reference) === needle)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new McpToolError(`Plusieurs matières correspondent à « ${key} » : précisez l’identifiant ou la référence.`);
  throw new McpToolError(`Aucune matière active ne correspond à « ${key} ». Consultez list_materials ou créez-la avec create_material.`);
}

/** Choix ou création d'une catégorie de matière et pré-remplissage de la référence (ex. CP-004). */
async function resolveMaterialCategory(businessId: string, categoryName: string | undefined, prefix: string | undefined) {
  if (!categoryName) return { categoryId: "", newCategoryName: "", newCategoryPrefix: "", prefix: "" };
  const existing = (await listMaterialCategories(businessId)).find((category) => lower(category.name) === lower(categoryName));
  if (existing) return { categoryId: existing.id, newCategoryName: "", newCategoryPrefix: "", prefix: existing.reference_prefix };
  const newPrefix = prefix || suggestReferencePrefix(categoryName);
  return { categoryId: "", newCategoryName: categoryName, newCategoryPrefix: newPrefix, prefix: newPrefix };
}

const materialFields = {
  name: z.string().trim().min(1).max(160).describe("Nom de la matière, ex. « Chaîne forçat argent 925 »."),
  category: z.string().trim().max(60).optional().describe("Catégorie de matière (existante ou nouvelle), ex. « Chaîne principale »."),
  category_prefix: z.string().trim().max(10).optional().describe("Préfixe de référence d’une NOUVELLE catégorie (ex. CP). Proposé automatiquement sinon."),
  reference: z.string().trim().max(80).optional().describe("Référence interne. Si absente, le prochain numéro de la catégorie est attribué (ex. CP-004)."),
  supplier: z.string().trim().max(160).optional().describe("Nom du fournisseur ; il est créé s’il n’existe pas encore."),
  color: z.string().trim().max(60).optional().describe("Couleur, ex. Argent, Doré, Or rose."),
  unit,
  package_quantity: quantity("Quantité contenue dans le lot acheté, dans l’unité choisie"),
  package_cost: amount("Prix du lot"),
  notes: z.string().trim().max(2000).optional(),
};

export const writeTools: McpTool<McpToolContext>[] = [
  {
    name: "create_supplier",
    kind: "write",
    title: "Créer un fournisseur",
    description: "Crée un fournisseur. Si un fournisseur actif porte déjà ce nom, il n’est pas recréé.",
    input: z.object({
      name: z.string().trim().min(1).max(160),
      email: z.string().trim().max(254).optional(),
      phone: z.string().trim().max(40).optional(),
      website: z.string().trim().max(300).optional(),
      address: z.string().trim().max(200).optional(),
      postal_code: z.string().trim().max(20).optional(),
      city: z.string().trim().max(120).optional(),
      country_code: z.string().trim().length(2).optional().describe("Code pays ISO à deux lettres, FR par défaut."),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as Record<string, string | undefined>;
      const existing = findSupplier(await listSuppliers(businessId), data.name ?? "");
      if (existing) return { cree: false, message: `Le fournisseur « ${existing.name} » existe déjà.`, id: existing.id };
      const parsed = supplierSchema.safeParse({ name: data.name, email: data.email, phone: data.phone, website: data.website, addressLine1: data.address, addressLine2: "", postalCode: data.postal_code, city: data.city, countryCode: data.country_code ?? "FR", registrationNumber: "", notes: data.notes, isActive: true });
      if (!parsed.success) invalid(parsed.error);
      const p = parsed.data;
      const { data: id, error } = await supabase.rpc("create_supplier", { p_business_id: businessId, p_name: p.name, p_email: p.email || null, p_phone: p.phone || null, p_website: p.website || null, p_address_line_1: p.addressLine1 || null, p_address_line_2: null, p_postal_code: p.postalCode || null, p_city: p.city || null, p_country_code: p.countryCode, p_registration_number: null, p_notes: p.notes || null });
      if (error) rpcFailure("Le fournisseur", error);
      return { cree: true, id: String(id), nom: p.name };
    },
  },
  {
    name: "create_material",
    kind: "write",
    title: "Créer une matière",
    description: "Crée une matière ou un composant avec son lot d’achat. Crée au besoin la catégorie et le fournisseur, et attribue la prochaine référence de la catégorie.",
    input: z.object(materialFields),
    run: async (input, { supabase, businessId }) => {
      const data = input as z.infer<z.ZodObject<typeof materialFields>>;
      const [materials, suppliers] = await Promise.all([listMaterials(businessId), listSuppliers(businessId)]);
      const duplicate = materials.find((material) => material.is_active && lower(material.name) === lower(data.name) && lower(material.color ?? "") === lower(data.color ?? ""));
      if (duplicate) throw new McpToolError(`La matière « ${duplicate.name} » existe déjà (id ${duplicate.id}). Utilisez update_material pour la modifier.`);
      const category = await resolveMaterialCategory(businessId, data.category, data.category_prefix);
      const supplier = data.supplier ? findSupplier(suppliers, data.supplier) : undefined;
      const reference = data.reference ?? (category.prefix ? suggestNextReference(category.prefix, materials.map((material) => material.internal_reference)) : "");
      const parsed = materialSchema.safeParse({ name: data.name, internalReference: reference, categoryId: category.categoryId, newCategoryName: category.newCategoryName, newCategoryPrefix: category.newCategoryPrefix, supplierId: supplier?.id ?? "", newSupplierName: supplier ? "" : data.supplier ?? "", color: data.color ?? "", unit: data.unit, packageQuantity: data.package_quantity, packageCost: data.package_cost, notes: data.notes ?? "", isActive: true });
      if (!parsed.success) invalid(parsed.error);
      const p = parsed.data;
      const { data: id, error } = await supabase.rpc("create_material", { p_business_id: businessId, p_name: p.name, p_internal_reference: p.internalReference || null, p_category_id: p.categoryId || null, p_new_category_name: p.newCategoryName || null, p_new_category_prefix: p.newCategoryPrefix || null, p_supplier_id: p.supplierId || null, p_new_supplier_name: p.newSupplierName || null, p_color: p.color || null, p_unit: p.unit, p_package_quantity_milliunits: p.packageQuantity, p_package_cost_cents: p.packageCost, p_notes: p.notes || null });
      if (error) rpcFailure("La matière", error);
      return { cree: true, id: String(id), nom: p.name, reference: p.internalReference || null, categorie: data.category ?? null, nouvelle_categorie: Boolean(category.newCategoryName), fournisseur: data.supplier ?? null, nouveau_fournisseur: Boolean(p.newSupplierName), cout_du_lot: formatEuroCents(p.packageCost) };
    },
  },
  {
    name: "update_material",
    kind: "write",
    title: "Modifier une matière",
    description: "Modifie une matière existante (seuls les champs fournis changent). L’unité d’une matière déjà utilisée dans une recette ne peut plus changer.",
    input: z.object({ material: z.string().trim().min(1).max(160).describe("Identifiant, référence ou nom exact de la matière."), ...Object.fromEntries(Object.entries(materialFields).map(([key, schema]) => [key, schema.optional()])), active: z.boolean().optional().describe("Faux pour archiver la matière.") }),
    run: async (input, { supabase, businessId }) => {
      const data = input as Partial<z.infer<z.ZodObject<typeof materialFields>>> & { material: string; active?: boolean };
      const [materials, suppliers] = await Promise.all([listMaterials(businessId), listSuppliers(businessId)]);
      const current = findMaterial(materials, data.material);
      const category = data.category === undefined
        ? { categoryId: current.category_id ?? "", newCategoryName: "", newCategoryPrefix: "" }
        : await resolveMaterialCategory(businessId, data.category, data.category_prefix);
      const supplier = data.supplier ? findSupplier(suppliers, data.supplier) : undefined;
      const parsed = materialSchema.safeParse({
        materialId: current.id,
        name: data.name ?? current.name,
        internalReference: data.reference ?? current.internal_reference ?? "",
        categoryId: category.categoryId, newCategoryName: category.newCategoryName, newCategoryPrefix: category.newCategoryPrefix,
        supplierId: data.supplier === undefined ? current.supplier_id ?? "" : supplier?.id ?? "",
        newSupplierName: data.supplier && !supplier ? data.supplier : "",
        color: data.color ?? current.color ?? "",
        unit: data.unit ?? current.unit,
        packageQuantity: data.package_quantity ?? String(current.package_quantity_milliunits / 1000),
        packageCost: data.package_cost ?? (current.package_cost_cents / 100).toFixed(2),
        notes: data.notes ?? current.notes ?? "",
        isActive: data.active ?? current.is_active,
      });
      if (!parsed.success) invalid(parsed.error);
      const p = parsed.data;
      const { error } = await supabase.rpc("update_material", { p_material_id: current.id, p_business_id: businessId, p_name: p.name, p_internal_reference: p.internalReference || null, p_category_id: p.categoryId || null, p_new_category_name: p.newCategoryName || null, p_new_category_prefix: p.newCategoryPrefix || null, p_supplier_id: p.supplierId || null, p_new_supplier_name: p.newSupplierName || null, p_color: p.color || null, p_unit: p.unit, p_package_quantity_milliunits: p.packageQuantity, p_package_cost_cents: p.packageCost, p_notes: p.notes || null, p_is_active: p.isActive });
      if (error) rpcFailure("La modification de la matière", error);
      return { modifie: true, id: current.id, nom: p.name, cout_du_lot: formatEuroCents(p.packageCost), active: p.isActive };
    },
  },
  {
    name: "create_product",
    kind: "write",
    title: "Créer un produit",
    description: "Crée un bijou avec son prix de vente et sa recette de fabrication (matières déjà créées et quantités consommées).",
    input: z.object({
      name: z.string().trim().min(1).max(160),
      sale_price: amount("Prix de vente"),
      category: z.string().trim().max(60).optional().describe("Catégorie de produit, ex. Collier, Bracelet, Boucles d’oreilles, Bague (ou une nouvelle)."),
      sku: z.string().trim().max(80).optional(),
      labor_minutes: z.number().int().min(0).max(10080).optional().describe("Temps de travail en minutes."),
      packaging_cost: amount("Emballage spécifique").optional().describe("Emballage spécifique en euros ; absent = emballage par défaut."),
      material_loss_percent: z.number().min(0).max(100).optional().describe("Pertes de fabrication en pourcentage."),
      recipe: z.array(z.object({ material: z.string().trim().min(1).max(160).describe("Identifiant, référence ou nom de la matière."), quantity: quantity("Quantité consommée dans l’unité de la matière") })).max(50).default([]),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { name: string; sale_price: string; category?: string; sku?: string; labor_minutes?: number; packaging_cost?: string; material_loss_percent?: number; recipe: Array<{ material: string; quantity: string }>; notes?: string };
      const existing = (await listProducts(businessId, { search: data.name })).find((product) => lower(product.name) === lower(data.name));
      if (existing) throw new McpToolError(`Le produit « ${existing.name} » existe déjà (id ${existing.id}).`);
      const materials = await listMaterials(businessId);
      const lines = data.recipe.map((line) => ({ material: findMaterial(materials, line.material), quantity: line.quantity }));
      if (new Set(lines.map((line) => line.material.id)).size !== lines.length) throw new McpToolError("Chaque matière ne peut apparaître qu’une fois dans la recette.");
      const parsed = productSchema.safeParse({ name: data.name, sku: data.sku ?? "", category: data.category ?? "Autre", salePrice: data.sale_price, laborMinutes: data.labor_minutes ?? 0, packagingCost: data.packaging_cost ?? "", materialLossPercent: data.material_loss_percent ?? 0, notes: data.notes ?? "", isActive: true });
      if (!parsed.success) invalid(parsed.error);
      const recipe = lines.map((line, index) => {
        let quantityMilliunits: number;
        try {
          quantityMilliunits = parseQuantityToMilliunits(line.quantity);
        } catch {
          throw new McpToolError(`Quantité invalide pour « ${line.material.name} ».`);
        }
        return { material_id: line.material.id, quantity_milliunits: quantityMilliunits, position: index + 1 };
      });
      const p = parsed.data;
      const { data: id, error } = await supabase.rpc("save_product_with_recipe", { p_product_id: null, p_business_id: businessId, p_name: p.name, p_sku: p.sku || null, p_category: p.category, p_sale_price_cents: p.salePrice, p_labor_minutes: p.laborMinutes, p_packaging_cost_cents: p.packagingCost === "" ? null : p.packagingCost, p_material_loss_basis_points: p.materialLossPercent, p_notes: p.notes || null, p_is_active: true, p_lines: recipe });
      if (error) rpcFailure("Le produit", error);
      return { cree: true, id: String(id), nom: p.name, categorie: p.category, prix_de_vente: formatEuroCents(p.salePrice), recette: lines.map((line) => line.material.name) };
    },
  },
  {
    name: "create_recurring_charge",
    kind: "write",
    title: "Créer une charge récurrente",
    description: "Crée une charge récurrente (abonnement, assurance, logiciel…). Elle compte dans la rentabilité si elle est fixe et de fonctionnement. Le fournisseur doit déjà exister.",
    input: z.object({
      description: z.string().trim().min(1).max(500),
      estimated_amount: amount("Montant estimé de chaque échéance"),
      frequency: z.enum(["monthly", "quarterly", "yearly"]).describe("monthly = mensuelle, quarterly = trimestrielle, yearly = annuelle."),
      next_due_on: isoDate("Prochaine échéance").optional(),
      category: expenseCategory,
      nature: nature.default("operating"),
      cost_behavior: costBehavior.default("fixed"),
      professional_share_percent: professionalShare.default(100),
      supplier: z.string().trim().max(160).optional().describe("Nom d’un fournisseur existant."),
      subcategory: z.string().trim().max(120).optional(),
      auto_generate: z.boolean().default(true).describe("Créer automatiquement un brouillon de dépense à chaque échéance."),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { description: string; estimated_amount: string; frequency: string; next_due_on?: string; category: string; nature: string; cost_behavior: string; professional_share_percent: number; supplier?: string; subcategory?: string; auto_generate: boolean; notes?: string };
      const supplier = data.supplier ? findSupplier(await listSuppliers(businessId), data.supplier) : undefined;
      if (data.supplier && !supplier) throw new McpToolError(`Le fournisseur « ${data.supplier} » n’existe pas. Créez-le d’abord avec create_supplier.`);
      const parsed = recurringSchema.safeParse({ supplierId: supplier?.id ?? "", category: data.category, subcategory: data.subcategory ?? "", nature: data.nature, costBehavior: data.cost_behavior, description: data.description, estimatedAmount: data.estimated_amount, professionalShare: data.professional_share_percent, frequency: data.frequency, nextDueOn: data.next_due_on ?? getTodayInParis(), notes: data.notes ?? "", isActive: true, autoGenerate: data.auto_generate });
      if (!parsed.success) invalid(parsed.error);
      const p = parsed.data;
      const { data: id, error } = await supabase.rpc("create_recurring_expense_template", { p_business_id: businessId, p_supplier_id: p.supplierId || null, p_category: p.category, p_subcategory: p.subcategory || null, p_nature: p.nature, p_cost_behavior: p.costBehavior, p_description: p.description, p_estimated_amount_cents: p.estimatedAmount, p_professional_share_basis_points: p.professionalShare, p_frequency: p.frequency, p_next_due_on: p.nextDueOn, p_notes: p.notes || null, p_auto_generate: p.autoGenerate });
      if (error) rpcFailure("La charge récurrente", error);
      return { cree: true, id: String(id), description: p.description, montant_estime: formatEuroCents(p.estimatedAmount), prochaine_echeance: p.nextDueOn };
    },
  },
  {
    name: "create_expense_draft",
    kind: "write",
    title: "Créer une dépense en brouillon",
    description: "Enregistre une dépense (achat de matières, matériel, frais…) en BROUILLON. L’utilisatrice la vérifie, ajoute le justificatif et la valide elle-même dans YrelCompta. Le fournisseur doit déjà exister.",
    input: z.object({
      description: z.string().trim().min(1).max(500),
      purchased_on: isoDate("Date d’achat"),
      total_amount: amount("Montant total TTC"),
      category: expenseCategory,
      nature: nature.default("operating"),
      cost_behavior: costBehavior.default("variable"),
      professional_share_percent: professionalShare.default(100),
      supplier: z.string().trim().max(160).optional().describe("Nom d’un fournisseur existant."),
      due_on: isoDate("Date d’échéance du paiement").optional(),
      external_reference: z.string().trim().max(200).optional().describe("Numéro de facture ou de commande du fournisseur."),
      subcategory: z.string().trim().max(120).optional(),
      notes: z.string().trim().max(2000).optional(),
      allow_duplicate: z.boolean().default(false).describe("Vrai seulement si l’utilisatrice confirme vouloir une deuxième dépense identique."),
    }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as { description: string; purchased_on: string; total_amount: string; category: string; nature: string; cost_behavior: string; professional_share_percent: number; supplier?: string; due_on?: string; external_reference?: string; subcategory?: string; notes?: string; allow_duplicate: boolean };
      const supplier = data.supplier ? findSupplier(await listSuppliers(businessId), data.supplier) : undefined;
      if (data.supplier && !supplier) throw new McpToolError(`Le fournisseur « ${data.supplier} » n’existe pas. Créez-le d’abord avec create_supplier.`);
      const parsed = expenseFormSchema.safeParse({ purchasedOn: data.purchased_on, dueOn: data.due_on ?? "", supplierId: supplier?.id ?? "", category: data.category, subcategory: data.subcategory ?? "", nature: data.nature, costBehavior: data.cost_behavior, description: data.description, externalReference: data.external_reference ?? "", totalAmount: data.total_amount, professionalShare: data.professional_share_percent, notes: data.notes ?? "" });
      if (!parsed.success) invalid(parsed.error);
      const p = parsed.data;
      if (!data.allow_duplicate) {
        const { data: similar, error: lookupError } = await supabase.from("expenses").select("id,description,status").eq("business_id", businessId).eq("purchased_on", p.purchasedOn).eq("total_amount_cents", p.totalAmount).neq("status", "cancelled");
        if (lookupError) rpcFailure("La vérification des doublons", lookupError);
        const twin = (similar ?? []).find((expense) => lower(String(expense.description)) === lower(p.description));
        if (twin) throw new McpToolError(`Une dépense identique existe déjà (même date, montant et description) : ${origin}/depenses/${twin.id}. Demandez à l’utilisatrice avant d’en créer une seconde (allow_duplicate).`);
      }
      const { data: id, error } = await supabase.rpc("create_expense_draft", { p_business_id: businessId, p_purchased_on: p.purchasedOn, p_due_on: p.dueOn || null, p_supplier_id: p.supplierId || null, p_category: p.category, p_subcategory: p.subcategory || null, p_nature: p.nature, p_cost_behavior: p.costBehavior, p_description: p.description, p_external_reference: p.externalReference || null, p_total_amount_cents: p.totalAmount, p_professional_share_basis_points: p.professionalShare, p_notes: p.notes || null });
      if (error) rpcFailure("La dépense", error);
      return { cree: true, statut: "brouillon", id: String(id), montant: formatEuroCents(p.totalAmount), a_valider_ici: `${origin}/depenses/${id}`, rappel: "La dépense est en brouillon : vérifiez-la, joignez le justificatif et validez-la dans YrelCompta." };
    },
  },
];
