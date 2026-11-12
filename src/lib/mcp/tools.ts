import "server-only";
import { z } from "zod";
import { expenseCategoryLabels, expenseCostBehaviorLabels, expenseNatureLabels, recurrenceFrequencyLabels } from "@/lib/expenses/labels";
import { listRecurringTemplates, listSuppliers } from "@/lib/expenses/queries";
import { formatBasisPoints } from "@/lib/fiscal-social/presentation";
import { calculateProfitabilityPlan } from "@/lib/profitability/calculations";
import { getProfitabilityData } from "@/lib/profitability/queries";
import { formatIndicativeUnitCost, formatMilliunits } from "@/lib/products/calculations";
import { materialUnitLabels } from "@/lib/products/labels";
import { listMaterialCategories, listMaterials, listProducts } from "@/lib/products/queries";
import { formatEuroCents } from "@/lib/sales/calculations";
import type { McpSession } from "./auth";
import type { McpTool } from "./protocol";

const search = z.string().trim().max(80).optional().describe("Texte recherché dans le nom ou la référence.");
const includeArchived = z.boolean().optional().describe("Inclure les éléments archivés (faux par défaut).");
const matches = (value: string, needle?: string) => !needle || value.toLocaleLowerCase("fr").includes(needle.toLocaleLowerCase("fr"));

export const readOnlyTools: McpTool<McpSession>[] = [
  {
    name: "list_material_categories",
    title: "Catégories de matières",
    description: "Liste les catégories de matières et leur préfixe de référence interne (ex. Chaîne principale → CP).",
    input: z.object({}),
    run: async (_input, { businessId }) => (await listMaterialCategories(businessId)).map((category) => ({ id: category.id, nom: category.name, prefixe_reference: category.reference_prefix })),
  },
  {
    name: "list_materials",
    title: "Matières et composants",
    description: "Liste les matières (chaînes, perles, fermoirs…) avec catégorie, couleur, référence, fournisseur, lot d’achat et coût indicatif par unité.",
    input: z.object({ search, category: z.string().trim().max(60).optional().describe("Nom de catégorie de matière."), include_archived: includeArchived }),
    run: async (input, { businessId }) => {
      const { search: needle, category, include_archived } = input as { search?: string; category?: string; include_archived?: boolean };
      return (await listMaterials(businessId))
        .filter((material) => include_archived || material.is_active)
        .filter((material) => !category || material.material_categories?.name.toLocaleLowerCase("fr") === category.toLocaleLowerCase("fr"))
        .filter((material) => matches(`${material.name} ${material.internal_reference ?? ""}`, needle))
        .map((material) => ({
          id: material.id,
          nom: material.name,
          categorie: material.material_categories?.name ?? null,
          couleur: material.color,
          reference: material.internal_reference,
          fournisseur: material.suppliers?.name ?? null,
          unite: materialUnitLabels[material.unit],
          quantite_du_lot: formatMilliunits(material.package_quantity_milliunits),
          cout_du_lot: formatEuroCents(material.package_cost_cents),
          cout_indicatif_par_unite: `${formatIndicativeUnitCost(material.package_cost_cents, material.package_quantity_milliunits)} €`,
          active: material.is_active,
        }));
    },
  },
  {
    name: "list_products",
    title: "Produits",
    description: "Liste les bijoux avec prix de vente, coût de fabrication estimé, marge estimée et recette de matières (100 produits au plus).",
    input: z.object({ search, category: z.string().trim().max(60).optional().describe("Catégorie de produit (ex. Collier)."), include_archived: includeArchived }),
    run: async (input, { businessId }) => {
      const { search: needle, category, include_archived } = input as { search?: string; category?: string; include_archived?: boolean };
      const products = await listProducts(businessId, { search: needle, category, active: include_archived ? undefined : "active" });
      return products.map((product) => ({
        id: product.id,
        nom: product.name,
        sku: product.sku,
        categorie: product.category,
        actif: product.is_active,
        prix_de_vente: formatEuroCents(product.sale_price_cents),
        cout_de_fabrication_estime: formatEuroCents(product.costing.manufacturingCostCents),
        marge_estimee: formatEuroCents(product.costing.grossMarginCents),
        taux_de_marge: product.costing.marginRatePercent === null ? null : `${product.costing.marginRatePercent.toFixed(1)} %`,
        temps_de_travail_minutes: product.labor_minutes,
        recette: product.product_materials.map((line) => ({ matiere: line.materials?.name ?? "Matière indisponible", quantite: formatMilliunits(line.quantity_milliunits), unite: line.materials ? materialUnitLabels[line.materials.unit] : null })),
      }));
    },
  },
  {
    name: "list_suppliers",
    title: "Fournisseurs",
    description: "Liste les fournisseurs avec leurs coordonnées.",
    input: z.object({ search, include_archived: includeArchived }),
    run: async (input, { businessId }) => {
      const { search: needle, include_archived } = input as { search?: string; include_archived?: boolean };
      return (await listSuppliers(businessId))
        .filter((supplier) => (include_archived || supplier.is_active) && matches(supplier.name, needle))
        .map((supplier) => ({ id: supplier.id, nom: supplier.name, email: supplier.email, telephone: supplier.phone, site: supplier.website, ville: supplier.city, actif: supplier.is_active }));
    },
  },
  {
    name: "list_recurring_charges",
    title: "Charges récurrentes",
    description: "Liste les charges récurrentes (abonnements, assurance, logiciels…) avec montant estimé, fréquence et prochaine échéance.",
    input: z.object({ include_archived: includeArchived }),
    run: async (input, { businessId }) => {
      const { include_archived } = input as { include_archived?: boolean };
      return (await listRecurringTemplates(businessId))
        .filter((template) => include_archived || template.is_active)
        .map((template) => ({
          id: template.id,
          description: template.description,
          fournisseur: template.suppliers?.name ?? null,
          categorie: expenseCategoryLabels[template.category],
          nature: expenseNatureLabels[template.nature],
          comportement: expenseCostBehaviorLabels[template.cost_behavior],
          montant_estime: formatEuroCents(template.estimated_amount_cents),
          part_professionnelle: formatBasisPoints(template.professional_share_basis_points),
          frequence: recurrenceFrequencyLabels[template.frequency],
          prochaine_echeance: template.next_due_on,
          creation_automatique: template.auto_generate,
          active: template.is_active,
        }));
    },
  },
  {
    name: "get_profitability",
    title: "Rentabilité",
    description: "Estime la marge à dégager chaque mois (charges fixes et matériel lissé), le chiffre d’affaires mensuel nécessaire et le nombre de bijoux à vendre. Estimation interne, ni comptable ni fiscale.",
    input: z.object({}),
    run: async (_input, { businessId }) => {
      const data = await getProfitabilityData(businessId);
      const plan = calculateProfitabilityPlan(data);
      const money = (cents: number | null) => cents === null ? null : formatEuroCents(cents);
      return {
        marge_a_degager_par_mois: money(plan.monthlyToCoverCents),
        charges_fixes_par_mois: money(plan.recurringMonthlyCents),
        materiel_lisse_par_mois: money(plan.equipmentMonthlyCents),
        taux_de_marge_de_reference: plan.marginRateBasisPoints === null ? null : formatBasisPoints(plan.marginRateBasisPoints),
        source_de_la_marge: data.reference?.source === "sales" ? "ventes des 90 derniers jours" : data.reference ? "catalogue des produits actifs" : null,
        chiffre_affaires_mensuel_necessaire_avant_cotisations: money(plan.breakEvenRevenueCents),
        chiffre_affaires_mensuel_necessaire_apres_cotisations: money(plan.breakEvenAfterLevyCents),
        taux_de_cotisations_estime: data.levyRateBasisPoints === null ? null : formatBasisPoints(data.levyRateBasisPoints),
        bijoux_a_vendre_par_mois: plan.unitsPerMonth,
        indisponible_car: plan.unavailableReason,
        charges_fixes: plan.chargeLines.map((line) => ({ description: line.description, frequence: recurrenceFrequencyLabels[line.frequency], montant_professionnel: money(line.professionalAmountCents), par_mois: money(line.monthlyCents) })),
        materiel_12_derniers_mois: data.equipment.map((expense) => ({ description: expense.description, date: expense.purchasedOn, montant_professionnel: money(expense.businessAmountCents) })),
      };
    },
  },
];
