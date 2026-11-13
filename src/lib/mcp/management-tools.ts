import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { calculateExpenseFinancials } from "@/lib/expenses/calculations";
import { expenseCategoryLabels, expenseCostBehaviorLabels, expenseNatureLabels, expensePaymentMethodLabels, expenseRefundKindLabels, expenseStatusLabels } from "@/lib/expenses/labels";
import { getExpense, listExpenses, listRecurringTemplates, listSuppliers } from "@/lib/expenses/queries";
import { cancellationSchema as expenseCancellationSchema, expenseCategories, expenseFormSchema, expensePaymentSchema, expenseRefundSchema, recurringSchema, supplierSchema } from "@/lib/expenses/validation";
import { getBillingDocument, listBillingDocuments } from "@/lib/invoicing/queries";
import { creditSchema, invoiceSchema } from "@/lib/invoicing/validation";
import { getCostingSettings, getProduct, listMaterialCategories, listMaterials, listProducts } from "@/lib/products/queries";
import { costingSettingsSchema, materialCategorySchema, parseQuantityToMilliunits, productSchema } from "@/lib/products/validation";
import { formatEuroCents } from "@/lib/sales/calculations";
import { cancellationSchema as saleCancellationSchema, paymentFormSchema, refundFormSchema, saleFormSchema } from "@/lib/sales/validation";
import { getTodayInParis } from "@/lib/utils/date";
import type { Expense, Supplier } from "@/types/expenses";
import type { SaleChannel } from "@/types/sales";
import type { McpToolContext } from "./auth";
import { McpToolError, type McpTool } from "./protocol";
import { findSale, resolveSaleItems, saleItemInput } from "./sales-tools";

const lower = (value: string) => value.trim().toLocaleLowerCase("fr");
const listing = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => `${key} = ${label}`).join(", ");
const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${label} au format AAAA-MM-JJ.`);
const amount = (label: string) => z.union([z.string().trim().max(20), z.number().nonnegative()]).transform(String).describe(`${label} en euros TTC, par exemple "12,50".`);
const euros = (cents: number) => (cents / 100).toFixed(2);

/**
 * Exigée pour toute action définitive : Claude ne peut la renseigner qu'après un accord explicite
 * de l'utilisatrice pour cette action précise, en plus de la demande d'autorisation de Claude.
 */
const confirmation = z.literal(true).describe("Action définitive : mettre true UNIQUEMENT après que l’utilisatrice a explicitement confirmé cette action précise dans la conversation, après un récapitulatif.");

const saleChannel = z.enum(["direct", "market", "instagram", "etsy", "website", "shopify", "retailer", "other"]);
const salePaymentMethod = z.enum(["cash", "card", "bank_transfer", "paypal", "stripe", "sumup", "etsy", "cheque", "other"]).describe("Moyen d’encaissement : cash, card, bank_transfer, paypal, stripe, sumup, etsy, cheque, other.");
const expensePaymentMethod = z.enum(["cash", "card", "bank_transfer", "paypal", "cheque", "direct_debit", "other"]).describe(`Moyen de paiement : ${listing(expensePaymentMethodLabels)}.`);
const expenseCategory = z.enum(expenseCategories).describe(`Catégorie : ${listing(expenseCategoryLabels)}.`);
const nature = z.enum(["operating", "investment", "tax_social"]).describe(`Nature : ${listing(expenseNatureLabels)}.`);
const costBehavior = z.enum(["fixed", "variable", "exceptional"]).describe(`Comportement : ${listing(expenseCostBehaviorLabels)}.`);
const professionalShare = z.number().min(0).max(100).describe("Part professionnelle suivie en interne, en pourcentage. Ce n’est pas une déduction fiscale.");

/** Traduit un refus de la base en message clair, sans détail technique. */
function refusal(label: string, error: { code?: string; message?: string }): never {
  console.error("Action de gestion du connecteur refusée", { label, code: error.code });
  const text = (error.message ?? "").toLowerCase();
  const known: Array<[string, string]> = [
    ["sale_already_validated", "Cette vente est déjà validée ou annulée."],
    ["draft required", "Cette action est réservée à un brouillon."],
    ["validated sale required", "La vente doit être validée et non annulée."],
    ["payment exceeds", "Ce montant dépasse le reste à encaisser ou à payer."],
    ["refund exceeds", "Le remboursement dépasse le montant encore remboursable."],
    ["non-zero", "L’annulation est impossible tant que le montant net encaissé ou payé n’est pas nul : enregistrez d’abord un remboursement."],
    ["billed_sale_requires_full_credit", "La vente est facturée : émettez d’abord un avoir couvrant toute la facture."],
    ["invoice settings required", "Complétez d’abord les paramètres de facturation dans YrelCompta."],
    ["professional invoice terms required", "Complétez les conditions B2B dans les paramètres de facturation."],
    ["invoice already issued", "Une facture a déjà été émise pour cette vente."],
    ["credit exceeds", "Le total des avoirs dépasserait le montant de la facture."],
    ["vat_invoicing_not_supported", "La facturation avec TVA n’est pas encore prise en charge par YrelCompta."],
    ["professional_buyer_siren_required", "Le SIREN à 9 chiffres est obligatoire pour un client professionnel."],
    ["recurring occurrence is stale", "Cette échéance a changé entre-temps : relisez la charge récurrente puis réessayez."],
    ["material unit is immutable once used", "L’unité d’une matière déjà utilisée ne peut plus être modifiée."],
  ];
  const match = known.find(([needle]) => text.includes(needle));
  if (match) throw new McpToolError(match[1]);
  if (error.code === "42501") throw new McpToolError("Accès refusé à cette entreprise.");
  if (error.code === "P0002") throw new McpToolError("L’élément demandé est introuvable.");
  if (error.code === "23505") throw new McpToolError("Cet élément existe déjà (nom, référence, SKU ou préfixe déjà utilisé).");
  if (error.code === "22003") throw new McpToolError("Le montant dépasse la limite autorisée.");
  if (error.code === "40001") throw new McpToolError("Les données ont changé entre-temps : relisez-les puis réessayez.");
  throw new McpToolError(`${label} a été refusé par YrelCompta : les données sont incohérentes.`);
}

async function rpc(supabase: SupabaseClient, name: string, args: Record<string, unknown>, label: string): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) refusal(label, error);
  return data;
}

function parseOrFail<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new McpToolError(`Données invalides : ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "entrée"} — ${issue.message}`).join(" ; ")}`);
  return parsed.data;
}

async function findExpense(businessId: string, key: string): Promise<Expense> {
  const id = z.string().uuid().safeParse(key).success ? key : (await listExpenses(businessId, { search: key })).find((expense) => lower(expense.reference) === lower(key))?.id;
  const expense = id ? await getExpense(businessId, id) : null;
  if (!expense) throw new McpToolError(`Aucune dépense ne correspond à « ${key} ». Consultez list_expenses.`);
  return expense;
}

function findSupplierIn(suppliers: Supplier[], key: string, activeOnly = false): Supplier {
  const matches = suppliers.filter((supplier) => (!activeOnly || supplier.is_active) && (supplier.id === key || lower(supplier.name) === lower(key)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new McpToolError(`Plusieurs fournisseurs s’appellent « ${key} » : précisez l’identifiant.`);
  throw new McpToolError(`Aucun fournisseur ne correspond à « ${key} ». Consultez list_suppliers.`);
}

async function supplierIdFor(businessId: string, name: string | undefined, current: string | null): Promise<string> {
  if (name === undefined) return current ?? "";
  if (name === "") return "";
  return findSupplierIn(await listSuppliers(businessId), name, true).id;
}

function expenseSummary(expense: Expense) {
  const financials = calculateExpenseFinancials(expense);
  return {
    id: expense.id,
    reference: expense.reference,
    date: expense.purchased_on,
    description: expense.description,
    fournisseur: expense.suppliers?.name ?? null,
    categorie: expenseCategoryLabels[expense.category],
    statut: expenseStatusLabels[expense.status],
    total: formatEuroCents(expense.total_amount_cents),
    montant_professionnel: formatEuroCents(expense.business_amount_cents),
    reste_a_payer: formatEuroCents(financials.remainingCents),
    justificatifs: expense.expense_documents.length,
  };
}

/* ---------- Ventes ---------- */

const saleTools: McpTool<McpToolContext>[] = [
  {
    name: "update_sale_draft",
    kind: "write",
    title: "Modifier une vente en brouillon",
    description: "Modifie une vente encore en brouillon. Seuls les champs fournis changent ; « items » remplace toutes les lignes.",
    input: z.object({
      sale: z.string().trim().min(1).max(80).describe("Identifiant ou référence de la vente."),
      ordered_on: isoDate("Date de commande").optional(),
      channel: saleChannel.optional(),
      customer_name: z.string().trim().max(160).optional(),
      items: z.array(saleItemInput).min(1).max(200).optional(),
      shipping: amount("Frais de port").optional(),
      discount: amount("Remise totale").optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as { sale: string; ordered_on?: string; channel?: SaleChannel; customer_name?: string; items?: Array<{ product?: string; description?: string; quantity: number; unit_price?: string }>; shipping?: string; discount?: string; notes?: string };
      const sale = await findSale(businessId, data.sale);
      if (sale.status !== "draft") throw new McpToolError("Seule une vente en brouillon peut être modifiée. Une vente validée se corrige par un remboursement ou une annulation.");
      const items = data.items ? await resolveSaleItems(businessId, data.items) : sale.sale_items.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: euros(item.unit_price_cents), productId: item.product_id }));
      const p = parseOrFail(saleFormSchema, { saleId: sale.id, orderedOn: data.ordered_on ?? sale.ordered_on, channel: data.channel ?? sale.channel, customerName: data.customer_name ?? sale.customer_name ?? "", notes: data.notes ?? sale.notes ?? "", shipping: data.shipping ?? euros(sale.shipping_cents), discount: data.discount ?? euros(sale.discount_cents), items });
      await rpc(supabase, "update_sale_draft", { p_sale_id: sale.id, p_business_id: businessId, p_ordered_on: p.orderedOn, p_channel: p.channel, p_customer_name: p.customerName || null, p_notes: p.notes || null, p_shipping_cents: p.shipping, p_discount_cents: p.discount, p_items: p.items.map((item) => ({ description: item.description, quantity: item.quantity, unit_price_cents: item.unitPrice, product_id: item.productId ?? null })) }, "La modification de la vente");
      return { modifie: true, reference: sale.reference, lien: `${origin}/ventes/${sale.id}` };
    },
  },
  {
    name: "delete_sale_draft",
    kind: "destructive",
    title: "Supprimer une vente en brouillon",
    description: "Supprime définitivement une vente en brouillon (impossible pour une vente validée).",
    input: z.object({ sale: z.string().trim().min(1).max(80), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const sale = await findSale(businessId, (input as { sale: string }).sale);
      await rpc(supabase, "delete_sale_draft", { p_sale_id: sale.id, p_business_id: businessId }, "La suppression du brouillon");
      return { supprime: true, reference: sale.reference };
    },
  },
  {
    name: "validate_sale",
    kind: "destructive",
    title: "Valider une vente",
    description: "Valide définitivement une vente en brouillon : elle devient inaltérable et compte dans le chiffre d’affaires.",
    input: z.object({ sale: z.string().trim().min(1).max(80), confirmation }),
    run: async (input, { supabase, businessId, origin }) => {
      const sale = await findSale(businessId, (input as { sale: string }).sale);
      await rpc(supabase, "validate_sale", { p_sale_id: sale.id, p_business_id: businessId }, "La validation de la vente");
      return { validee: true, reference: sale.reference, total: formatEuroCents(sale.total_cents), lien: `${origin}/ventes/${sale.id}` };
    },
  },
  {
    name: "record_sale_payment",
    kind: "destructive",
    title: "Enregistrer un encaissement",
    description: "Enregistre définitivement un encaissement sur une vente validée (une erreur se corrige ensuite par un remboursement).",
    input: z.object({
      sale: z.string().trim().min(1).max(80),
      amount: amount("Montant brut encaissé"),
      method: salePaymentMethod,
      received_on: isoDate("Date d’encaissement").optional(),
      platform_fee: amount("Commission de la plateforme (Etsy, SumUp…)").optional(),
      bank_deposited_on: isoDate("Date de versement sur le compte").optional(),
      external_reference: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(2000).optional(),
      confirmation,
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { sale: string; amount: string; method: string; received_on?: string; platform_fee?: string; bank_deposited_on?: string; external_reference?: string; notes?: string };
      const sale = await findSale(businessId, data.sale);
      const p = parseOrFail(paymentFormSchema, { saleId: sale.id, receivedOn: data.received_on ?? getTodayInParis(), bankDepositedOn: data.bank_deposited_on ?? "", grossAmount: data.amount, platformFee: data.platform_fee ?? "", method: data.method, externalReference: data.external_reference ?? "", notes: data.notes ?? "" });
      await rpc(supabase, "record_payment", { p_sale_id: sale.id, p_business_id: businessId, p_received_on: p.receivedOn, p_bank_deposited_on: p.bankDepositedOn || null, p_gross_amount_cents: p.grossAmount, p_platform_fee_cents: p.platformFee, p_method: p.method, p_external_reference: p.externalReference || null, p_notes: p.notes || null }, "L’encaissement");
      return { enregistre: true, vente: sale.reference, montant: formatEuroCents(p.grossAmount), commission: formatEuroCents(p.platformFee) };
    },
  },
  {
    name: "record_sale_refund",
    kind: "destructive",
    title: "Rembourser une cliente",
    description: "Enregistre définitivement un remboursement sur un encaissement d’une vente (identifiant visible dans get_sale).",
    input: z.object({
      sale: z.string().trim().min(1).max(80),
      payment_id: z.string().uuid().optional().describe("Encaissement remboursé ; facultatif si la vente n’en a qu’un."),
      amount: amount("Montant remboursé"),
      reason: z.string().trim().min(2).max(500).describe("Motif du remboursement."),
      kind: z.enum(["customer_refund", "correction"]).default("customer_refund").describe("customer_refund = remboursement client, correction = correction d’erreur."),
      refunded_on: isoDate("Date du remboursement").optional(),
      confirmation,
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { sale: string; payment_id?: string; amount: string; reason: string; kind: string; refunded_on?: string };
      const sale = await findSale(businessId, data.sale);
      const payment = data.payment_id ? sale.payments.find((candidate) => candidate.id === data.payment_id) : sale.payments.length === 1 ? sale.payments[0] : undefined;
      if (!payment) throw new McpToolError(sale.payments.length === 0 ? "Cette vente n’a aucun encaissement à rembourser." : "Précisez l’encaissement remboursé (payment_id, visible dans get_sale).");
      const p = parseOrFail(refundFormSchema, { paymentId: payment.id, saleId: sale.id, refundedOn: data.refunded_on ?? getTodayInParis(), amount: data.amount, kind: data.kind, reason: data.reason });
      await rpc(supabase, "record_refund", { p_payment_id: payment.id, p_sale_id: sale.id, p_business_id: businessId, p_refunded_on: p.refundedOn, p_amount_cents: p.amount, p_kind: p.kind, p_reason: p.reason }, "Le remboursement");
      return { enregistre: true, vente: sale.reference, montant: formatEuroCents(p.amount) };
    },
  },
  {
    name: "cancel_sale",
    kind: "destructive",
    title: "Annuler une vente",
    description: "Annule définitivement une vente validée. Le montant net encaissé doit être nul (rembourser d’abord) et une vente facturée doit être couverte par un avoir.",
    input: z.object({ sale: z.string().trim().min(1).max(80), reason: z.string().trim().min(2).max(500), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { sale: string; reason: string };
      const sale = await findSale(businessId, data.sale);
      const p = parseOrFail(saleCancellationSchema, { saleId: sale.id, reason: data.reason });
      await rpc(supabase, "cancel_sale", { p_sale_id: sale.id, p_business_id: businessId, p_reason: p.reason }, "L’annulation de la vente");
      return { annulee: true, reference: sale.reference };
    },
  },
];

/* ---------- Factures ---------- */

const invoiceTools: McpTool<McpToolContext>[] = [
  {
    name: "issue_invoice",
    kind: "destructive",
    title: "Émettre une facture",
    description: "Émet définitivement la facture d’une vente validée : elle reçoit un numéro qui ne pourra jamais être supprimé (une erreur se corrige par un avoir).",
    input: z.object({
      sale: z.string().trim().min(1).max(80),
      buyer_kind: z.enum(["individual", "professional"]).default("individual").describe("individual = particulier, professional = professionnel (SIREN obligatoire)."),
      buyer_name: z.string().trim().max(200).optional().describe("Nom de l’acheteur ; le nom de la cliente de la vente par défaut."),
      buyer_address: z.string().trim().max(1000).optional(),
      buyer_address_omitted: z.boolean().default(false).describe("Vrai si l’adresse d’un particulier n’est pas mentionnée."),
      buyer_billing_address: z.string().trim().max(1000).optional(),
      buyer_delivery_address: z.string().trim().max(1000).optional(),
      buyer_email: z.string().trim().max(254).optional(),
      buyer_siren: z.string().trim().max(9).optional(),
      buyer_vat_number: z.string().trim().max(50).optional(),
      purchase_order_reference: z.string().trim().max(200).optional(),
      operation_category: z.enum(["goods", "services", "mixed"]).default("goods").describe("goods = vente de biens, services = prestations, mixed = les deux."),
      supply_on: isoDate("Date de livraison ou de réalisation").optional(),
      payment_due_on: isoDate("Date d’échéance du paiement").optional(),
      confirmation,
    }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as Record<string, string | boolean | undefined> & { sale: string };
      const sale = await findSale(businessId, data.sale);
      const buyerName = (data.buyer_name as string | undefined) || sale.customer_name;
      if (!buyerName) throw new McpToolError("Indiquez le nom de l’acheteur (buyer_name).");
      const today = getTodayInParis();
      const p = parseOrFail(invoiceSchema, { saleId: sale.id, supplyOn: data.supply_on ?? sale.ordered_on, operationCategory: data.operation_category, buyerKind: data.buyer_kind, buyerName, buyerAddress: data.buyer_address ?? "", buyerAddressOmitted: data.buyer_address_omitted, buyerBillingAddress: data.buyer_billing_address ?? "", buyerDeliveryAddress: data.buyer_delivery_address ?? "", buyerEmail: data.buyer_email ?? "", buyerSiren: data.buyer_siren ?? "", buyerVatNumber: data.buyer_vat_number ?? "", purchaseOrderReference: data.purchase_order_reference ?? "", paymentDueOn: data.payment_due_on ?? today });
      const id = await rpc(supabase, "issue_invoice", { p_business_id: businessId, p_sale_id: p.saleId, p_supply_on: p.supplyOn, p_operation_category: p.operationCategory, p_buyer_kind: p.buyerKind, p_buyer_name: p.buyerName, p_buyer_address: p.buyerAddress || null, p_buyer_address_omitted: p.buyerAddressOmitted, p_buyer_billing_address: p.buyerBillingAddress || null, p_buyer_delivery_address: p.buyerDeliveryAddress || null, p_buyer_email: p.buyerEmail || null, p_buyer_siren: p.buyerSiren || null, p_buyer_vat_number: p.buyerVatNumber || null, p_purchase_order_reference: p.purchaseOrderReference || null, p_payment_due_on: p.paymentDueOn }, "L’émission de la facture");
      const issued = await getBillingDocument(businessId, String(id));
      return { emise: true, numero: issued?.document.number ?? null, total_ttc: issued ? formatEuroCents(issued.document.totalInclTaxCents) : null, pdf: `${origin}/factures/${id}/pdf` };
    },
  },
  {
    name: "issue_credit_note",
    kind: "destructive",
    title: "Émettre un avoir",
    description: "Émet définitivement un avoir sur une facture (correction ou remboursement). Il reçoit un numéro qui ne pourra jamais être supprimé.",
    input: z.object({
      invoice: z.string().trim().min(1).max(80).describe("Identifiant ou numéro de la facture d’origine."),
      amount: amount("Montant de l’avoir"),
      reason: z.string().trim().min(2).max(500),
      linked_refund_id: z.string().uuid().optional().describe("Remboursement client lié, visible dans get_sale."),
      confirmation,
    }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as { invoice: string; amount: string; reason: string; linked_refund_id?: string };
      const invoiceId = z.string().uuid().safeParse(data.invoice).success ? data.invoice : (await listBillingDocuments(businessId, { search: data.invoice })).find((document) => lower(document.number) === lower(data.invoice))?.id;
      if (!invoiceId) throw new McpToolError(`Aucune facture ne correspond à « ${data.invoice} ».`);
      const p = parseOrFail(creditSchema, { invoiceId, amount: data.amount, reason: data.reason, linkedRefundId: data.linked_refund_id ?? "" });
      const id = await rpc(supabase, "issue_credit_note", { p_business_id: businessId, p_original_invoice_id: p.invoiceId, p_amount_cents: p.amount, p_reason: p.reason, p_linked_refund_id: p.linkedRefundId || null }, "L’émission de l’avoir");
      const issued = await getBillingDocument(businessId, String(id));
      return { emis: true, numero: issued?.document.number ?? null, montant: formatEuroCents(p.amount), pdf: `${origin}/factures/${id}/pdf` };
    },
  },
];

/* ---------- Dépenses ---------- */

const expenseTools: McpTool<McpToolContext>[] = [
  {
    name: "list_expenses",
    title: "Dépenses",
    description: "Liste les dépenses (100 au plus) avec statut, montant, reste à payer et nombre de justificatifs.",
    input: z.object({
      status: z.enum(["draft", "validated", "cancelled"]).optional().describe(`Statut : ${listing(expenseStatusLabels)}.`),
      category: expenseCategory.optional(),
      from: isoDate("Début de période").optional(),
      to: isoDate("Fin de période").optional(),
      search: z.string().trim().max(80).optional().describe("Référence, description ou fournisseur."),
    }),
    run: async (input, { businessId }) => (await listExpenses(businessId, input as Record<string, never>)).map(expenseSummary),
  },
  {
    name: "get_expense",
    title: "Détail d’une dépense",
    description: "Détail d’une dépense avec ses paiements (identifiants utiles pour un remboursement) et ses remboursements.",
    input: z.object({ expense: z.string().trim().min(1).max(80).describe("Identifiant ou référence de la dépense.") }),
    run: async (input, { businessId }) => {
      const expense = await findExpense(businessId, (input as { expense: string }).expense);
      return {
        ...expenseSummary(expense),
        nature: expenseNatureLabels[expense.nature],
        comportement: expenseCostBehaviorLabels[expense.cost_behavior],
        part_professionnelle: `${expense.professional_share_basis_points / 100} %`,
        echeance: expense.due_on,
        reference_fournisseur: expense.external_reference,
        notes: expense.notes,
        motif_annulation: expense.cancellation_reason,
        paiements: expense.expense_payments.map((payment) => ({ id: payment.id, date: payment.paid_on, montant: formatEuroCents(payment.amount_cents), moyen: expensePaymentMethodLabels[payment.method], remboursements: payment.expense_refunds.map((refund) => ({ date: refund.received_on, montant: formatEuroCents(refund.amount_cents), type: expenseRefundKindLabels[refund.kind], motif: refund.reason })) })),
      };
    },
  },
  {
    name: "update_expense_draft",
    kind: "write",
    title: "Modifier une dépense en brouillon",
    description: "Modifie une dépense encore en brouillon. Seuls les champs fournis changent.",
    input: z.object({
      expense: z.string().trim().min(1).max(80),
      description: z.string().trim().min(1).max(500).optional(),
      purchased_on: isoDate("Date d’achat").optional(),
      total_amount: amount("Montant total").optional(),
      category: expenseCategory.optional(),
      nature: nature.optional(),
      cost_behavior: costBehavior.optional(),
      professional_share_percent: professionalShare.optional(),
      supplier: z.string().trim().max(160).optional().describe("Nom d’un fournisseur existant ; chaîne vide pour retirer le fournisseur."),
      due_on: isoDate("Échéance").optional(),
      external_reference: z.string().trim().max(200).optional(),
      subcategory: z.string().trim().max(120).optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as Record<string, string | number | undefined> & { expense: string };
      const expense = await findExpense(businessId, data.expense);
      if (expense.status !== "draft") throw new McpToolError("Seule une dépense en brouillon peut être modifiée. Une dépense validée se corrige par un remboursement ou une annulation.");
      const supplierId = await supplierIdFor(businessId, data.supplier as string | undefined, expense.supplier_id);
      const p = parseOrFail(expenseFormSchema, { expenseId: expense.id, purchasedOn: data.purchased_on ?? expense.purchased_on, dueOn: data.due_on ?? expense.due_on ?? "", supplierId, category: data.category ?? expense.category, subcategory: data.subcategory ?? expense.subcategory ?? "", nature: data.nature ?? expense.nature, costBehavior: data.cost_behavior ?? expense.cost_behavior, description: data.description ?? expense.description, externalReference: data.external_reference ?? expense.external_reference ?? "", totalAmount: data.total_amount ?? euros(expense.total_amount_cents), professionalShare: data.professional_share_percent ?? expense.professional_share_basis_points / 100, notes: data.notes ?? expense.notes ?? "" });
      await rpc(supabase, "update_expense_draft", { p_expense_id: expense.id, p_business_id: businessId, p_purchased_on: p.purchasedOn, p_due_on: p.dueOn || null, p_supplier_id: p.supplierId || null, p_category: p.category, p_subcategory: p.subcategory || null, p_nature: p.nature, p_cost_behavior: p.costBehavior, p_description: p.description, p_external_reference: p.externalReference || null, p_total_amount_cents: p.totalAmount, p_professional_share_basis_points: p.professionalShare, p_notes: p.notes || null }, "La modification de la dépense");
      return { modifiee: true, reference: expense.reference, lien: `${origin}/depenses/${expense.id}` };
    },
  },
  {
    name: "delete_expense_draft",
    kind: "destructive",
    title: "Supprimer une dépense en brouillon",
    description: "Supprime définitivement une dépense en brouillon (impossible pour une dépense validée).",
    input: z.object({ expense: z.string().trim().min(1).max(80), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const expense = await findExpense(businessId, (input as { expense: string }).expense);
      await rpc(supabase, "delete_expense_draft", { p_expense_id: expense.id, p_business_id: businessId }, "La suppression du brouillon");
      return { supprimee: true, reference: expense.reference };
    },
  },
  {
    name: "validate_expense",
    kind: "destructive",
    title: "Valider une dépense",
    description: "Valide définitivement une dépense en brouillon : elle devient inaltérable et entre dans le registre des achats.",
    input: z.object({ expense: z.string().trim().min(1).max(80), confirmation }),
    run: async (input, { supabase, businessId, origin }) => {
      const expense = await findExpense(businessId, (input as { expense: string }).expense);
      await rpc(supabase, "validate_expense", { p_expense_id: expense.id, p_business_id: businessId }, "La validation de la dépense");
      return { validee: true, reference: expense.reference, justificatifs: expense.expense_documents.length, rappel: expense.expense_documents.length === 0 ? `Pensez à joindre le justificatif : ${origin}/depenses/${expense.id}` : null };
    },
  },
  {
    name: "record_expense_payment",
    kind: "destructive",
    title: "Enregistrer le paiement d’une dépense",
    description: "Enregistre définitivement un paiement sur une dépense validée.",
    input: z.object({
      expense: z.string().trim().min(1).max(80),
      amount: amount("Montant payé"),
      method: expensePaymentMethod,
      paid_on: isoDate("Date du paiement").optional(),
      bank_debited_on: isoDate("Date de débit bancaire").optional(),
      external_reference: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(2000).optional(),
      confirmation,
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { expense: string; amount: string; method: string; paid_on?: string; bank_debited_on?: string; external_reference?: string; notes?: string };
      const expense = await findExpense(businessId, data.expense);
      const p = parseOrFail(expensePaymentSchema, { expenseId: expense.id, paidOn: data.paid_on ?? getTodayInParis(), bankDebitedOn: data.bank_debited_on ?? "", amount: data.amount, method: data.method, externalReference: data.external_reference ?? "", notes: data.notes ?? "" });
      await rpc(supabase, "record_expense_payment", { p_expense_id: expense.id, p_business_id: businessId, p_paid_on: p.paidOn, p_bank_debited_on: p.bankDebitedOn || null, p_amount_cents: p.amount, p_method: p.method, p_external_reference: p.externalReference || null, p_notes: p.notes || null }, "Le paiement");
      return { enregistre: true, depense: expense.reference, montant: formatEuroCents(p.amount) };
    },
  },
  {
    name: "record_expense_refund",
    kind: "destructive",
    title: "Enregistrer un remboursement fournisseur",
    description: "Enregistre définitivement un remboursement ou un avoir fournisseur sur un paiement de dépense (identifiant visible dans get_expense).",
    input: z.object({
      expense: z.string().trim().min(1).max(80),
      payment_id: z.string().uuid().optional().describe("Paiement concerné ; facultatif si la dépense n’en a qu’un."),
      amount: amount("Montant remboursé"),
      reason: z.string().trim().min(2).max(500),
      kind: z.enum(["supplier_refund", "credit_note", "correction"]).default("supplier_refund").describe(`Type : ${listing(expenseRefundKindLabels)}.`),
      received_on: isoDate("Date de réception").optional(),
      external_reference: z.string().trim().max(200).optional(),
      confirmation,
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { expense: string; payment_id?: string; amount: string; reason: string; kind: string; received_on?: string; external_reference?: string };
      const expense = await findExpense(businessId, data.expense);
      const payment = data.payment_id ? expense.expense_payments.find((candidate) => candidate.id === data.payment_id) : expense.expense_payments.length === 1 ? expense.expense_payments[0] : undefined;
      if (!payment) throw new McpToolError(expense.expense_payments.length === 0 ? "Cette dépense n’a aucun paiement à rembourser." : "Précisez le paiement concerné (payment_id, visible dans get_expense).");
      const p = parseOrFail(expenseRefundSchema, { expenseId: expense.id, paymentId: payment.id, paidOn: payment.paid_on, receivedOn: data.received_on ?? getTodayInParis(), amount: data.amount, kind: data.kind, reason: data.reason, externalReference: data.external_reference ?? "" });
      await rpc(supabase, "record_expense_refund", { p_expense_payment_id: payment.id, p_expense_id: expense.id, p_business_id: businessId, p_received_on: p.receivedOn, p_amount_cents: p.amount, p_kind: p.kind, p_reason: p.reason, p_external_reference: p.externalReference || null }, "Le remboursement fournisseur");
      return { enregistre: true, depense: expense.reference, montant: formatEuroCents(p.amount) };
    },
  },
  {
    name: "cancel_expense",
    kind: "destructive",
    title: "Annuler une dépense",
    description: "Annule définitivement une dépense validée. Le montant net payé doit être nul (enregistrer d’abord un remboursement).",
    input: z.object({ expense: z.string().trim().min(1).max(80), reason: z.string().trim().min(2).max(500), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { expense: string; reason: string };
      const expense = await findExpense(businessId, data.expense);
      const p = parseOrFail(expenseCancellationSchema, { expenseId: expense.id, reason: data.reason });
      await rpc(supabase, "cancel_expense", { p_expense_id: expense.id, p_business_id: businessId, p_reason: p.reason }, "L’annulation de la dépense");
      return { annulee: true, reference: expense.reference };
    },
  },
];

/* ---------- Fournisseurs et charges récurrentes ---------- */

const supplierAndRecurringTools: McpTool<McpToolContext>[] = [
  {
    name: "update_supplier",
    kind: "write",
    title: "Modifier un fournisseur",
    description: "Modifie les coordonnées d’un fournisseur. Seuls les champs fournis changent.",
    input: z.object({
      supplier: z.string().trim().min(1).max(160).describe("Identifiant ou nom exact du fournisseur."),
      name: z.string().trim().min(1).max(160).optional(),
      email: z.string().trim().max(254).optional(),
      phone: z.string().trim().max(40).optional(),
      website: z.string().trim().max(300).optional(),
      address: z.string().trim().max(200).optional(),
      address_line_2: z.string().trim().max(200).optional(),
      postal_code: z.string().trim().max(20).optional(),
      city: z.string().trim().max(120).optional(),
      country_code: z.string().trim().length(2).optional(),
      registration_number: z.string().trim().max(80).optional(),
      notes: z.string().trim().max(2000).optional(),
      active: z.boolean().optional().describe("Faux pour archiver, vrai pour réactiver."),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as Record<string, string | boolean | undefined> & { supplier: string };
      const current = findSupplierIn(await listSuppliers(businessId), data.supplier);
      const p = parseOrFail(supplierSchema, { supplierId: current.id, name: data.name ?? current.name, email: data.email ?? current.email ?? "", phone: data.phone ?? current.phone ?? "", website: data.website ?? current.website ?? "", addressLine1: data.address ?? current.address_line_1 ?? "", addressLine2: data.address_line_2 ?? current.address_line_2 ?? "", postalCode: data.postal_code ?? current.postal_code ?? "", city: data.city ?? current.city ?? "", countryCode: data.country_code ?? current.country_code, registrationNumber: data.registration_number ?? current.registration_number ?? "", notes: data.notes ?? current.notes ?? "", isActive: data.active ?? current.is_active });
      await rpc(supabase, "update_supplier", { p_supplier_id: current.id, p_business_id: businessId, p_name: p.name, p_email: p.email || null, p_phone: p.phone || null, p_website: p.website || null, p_address_line_1: p.addressLine1 || null, p_address_line_2: p.addressLine2 || null, p_postal_code: p.postalCode || null, p_city: p.city || null, p_country_code: p.countryCode, p_registration_number: p.registrationNumber || null, p_notes: p.notes || null, p_is_active: p.isActive }, "La modification du fournisseur");
      return { modifie: true, nom: p.name, actif: p.isActive };
    },
  },
  {
    name: "archive_supplier",
    kind: "destructive",
    title: "Archiver un fournisseur",
    description: "Archive un fournisseur : il n’est plus proposé, mais l’historique des dépenses est conservé.",
    input: z.object({ supplier: z.string().trim().min(1).max(160), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const supplier = findSupplierIn(await listSuppliers(businessId), (input as { supplier: string }).supplier);
      await rpc(supabase, "archive_supplier", { p_supplier_id: supplier.id, p_business_id: businessId }, "L’archivage du fournisseur");
      return { archive: true, nom: supplier.name };
    },
  },
  {
    name: "update_recurring_charge",
    kind: "write",
    title: "Modifier une charge récurrente",
    description: "Modifie une charge récurrente (montant, fréquence, échéance…). Seuls les champs fournis changent.",
    input: z.object({
      charge: z.string().trim().min(1).max(500).describe("Identifiant ou description exacte de la charge."),
      description: z.string().trim().min(1).max(500).optional(),
      estimated_amount: amount("Montant estimé de chaque échéance").optional(),
      frequency: z.enum(["monthly", "quarterly", "yearly"]).optional(),
      next_due_on: isoDate("Prochaine échéance").optional(),
      category: expenseCategory.optional(),
      nature: nature.optional(),
      cost_behavior: costBehavior.optional(),
      professional_share_percent: professionalShare.optional(),
      supplier: z.string().trim().max(160).optional().describe("Nom d’un fournisseur existant ; chaîne vide pour le retirer."),
      subcategory: z.string().trim().max(120).optional(),
      auto_generate: z.boolean().optional(),
      active: z.boolean().optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as Record<string, string | number | boolean | undefined> & { charge: string };
      const templates = await listRecurringTemplates(businessId);
      const matches = templates.filter((template) => template.id === data.charge || lower(template.description) === lower(data.charge));
      if (matches.length !== 1) throw new McpToolError(matches.length ? "Plusieurs charges portent ce nom : précisez l’identifiant." : `Aucune charge récurrente ne correspond à « ${data.charge} ».`);
      const current = matches[0];
      const supplierId = await supplierIdFor(businessId, data.supplier as string | undefined, current.supplier_id);
      const p = parseOrFail(recurringSchema, { templateId: current.id, supplierId, category: data.category ?? current.category, subcategory: data.subcategory ?? current.subcategory ?? "", nature: data.nature ?? current.nature, costBehavior: data.cost_behavior ?? current.cost_behavior, description: data.description ?? current.description, estimatedAmount: data.estimated_amount ?? euros(current.estimated_amount_cents), professionalShare: data.professional_share_percent ?? current.professional_share_basis_points / 100, frequency: data.frequency ?? current.frequency, nextDueOn: data.next_due_on ?? current.next_due_on, notes: data.notes ?? current.notes ?? "", isActive: data.active ?? current.is_active, autoGenerate: data.auto_generate ?? current.auto_generate });
      await rpc(supabase, "update_recurring_expense_template", { p_template_id: current.id, p_business_id: businessId, p_supplier_id: p.supplierId || null, p_category: p.category, p_subcategory: p.subcategory || null, p_nature: p.nature, p_cost_behavior: p.costBehavior, p_description: p.description, p_estimated_amount_cents: p.estimatedAmount, p_professional_share_basis_points: p.professionalShare, p_frequency: p.frequency, p_next_due_on: p.nextDueOn, p_notes: p.notes || null, p_auto_generate: p.autoGenerate, p_is_active: p.isActive }, "La modification de la charge");
      return { modifiee: true, description: p.description, montant_estime: formatEuroCents(p.estimatedAmount), prochaine_echeance: p.nextDueOn };
    },
  },
  {
    name: "archive_recurring_charge",
    kind: "destructive",
    title: "Archiver une charge récurrente",
    description: "Archive une charge récurrente : elle ne génère plus de brouillon et ne compte plus dans la rentabilité.",
    input: z.object({ charge: z.string().trim().min(1).max(500), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const key = (input as { charge: string }).charge;
      const matches = (await listRecurringTemplates(businessId)).filter((template) => template.id === key || lower(template.description) === lower(key));
      if (matches.length !== 1) throw new McpToolError(matches.length ? "Plusieurs charges portent ce nom : précisez l’identifiant." : `Aucune charge récurrente ne correspond à « ${key} ».`);
      await rpc(supabase, "archive_recurring_expense_template", { p_template_id: matches[0].id, p_business_id: businessId }, "L’archivage de la charge");
      return { archivee: true, description: matches[0].description };
    },
  },
  {
    name: "generate_expense_from_recurring_charge",
    kind: "write",
    title: "Générer la dépense d’une charge récurrente",
    description: "Crée en brouillon la dépense de la prochaine échéance d’une charge récurrente.",
    input: z.object({ charge: z.string().trim().min(1).max(500), purchased_on: isoDate("Date d’achat").optional() }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as { charge: string; purchased_on?: string };
      const matches = (await listRecurringTemplates(businessId)).filter((template) => template.is_active && (template.id === data.charge || lower(template.description) === lower(data.charge)));
      if (matches.length !== 1) throw new McpToolError(matches.length ? "Plusieurs charges portent ce nom : précisez l’identifiant." : `Aucune charge récurrente active ne correspond à « ${data.charge} ».`);
      const id = await rpc(supabase, "create_expense_from_recurring_template", { p_template_id: matches[0].id, p_business_id: businessId, p_purchased_on: data.purchased_on ?? getTodayInParis(), p_recurring_due_on: matches[0].next_due_on }, "La génération de la dépense");
      return { cree: true, statut: "brouillon", a_valider_ici: `${origin}/depenses/${id}` };
    },
  },
];

/* ---------- Catalogue et coûts ---------- */

const catalogTools: McpTool<McpToolContext>[] = [
  {
    name: "update_product",
    kind: "write",
    title: "Modifier un produit",
    description: "Modifie un produit (prix, catégorie, temps, recette…). Seuls les champs fournis changent ; « recipe » remplace toute la recette.",
    input: z.object({
      product: z.string().trim().min(1).max(160).describe("Identifiant, SKU ou nom exact du produit."),
      name: z.string().trim().min(1).max(160).optional(),
      sale_price: amount("Prix de vente").optional(),
      category: z.string().trim().max(60).optional(),
      sku: z.string().trim().max(80).optional(),
      labor_minutes: z.number().int().min(0).max(10080).optional(),
      packaging_cost: amount("Emballage spécifique").optional().describe("Emballage spécifique en euros ; chaîne vide = emballage par défaut."),
      material_loss_percent: z.number().min(0).max(100).optional(),
      recipe: z.array(z.object({ material: z.string().trim().min(1).max(160), quantity: z.union([z.string().trim().max(20), z.number().positive()]).transform(String) })).max(50).optional(),
      notes: z.string().trim().max(2000).optional(),
      active: z.boolean().optional().describe("Faux pour archiver, vrai pour réactiver."),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { product: string; name?: string; sale_price?: string; category?: string; sku?: string; labor_minutes?: number; packaging_cost?: string; material_loss_percent?: number; recipe?: Array<{ material: string; quantity: string }>; notes?: string; active?: boolean };
      const candidates = (await listProducts(businessId, { search: z.string().uuid().safeParse(data.product).success ? undefined : data.product })).filter((product) => product.id === data.product || lower(product.name) === lower(data.product) || (product.sku && lower(product.sku) === lower(data.product)));
      if (candidates.length !== 1) throw new McpToolError(candidates.length ? "Plusieurs produits correspondent : précisez l’identifiant." : `Aucun produit ne correspond à « ${data.product} ».`);
      const current = await getProduct(businessId, candidates[0].id);
      if (!current) throw new McpToolError("Produit introuvable.");
      let lines = current.product_materials.map((line) => ({ material_id: line.material_id, quantity_milliunits: line.quantity_milliunits }));
      if (data.recipe) {
        const materials = await listMaterials(businessId);
        lines = data.recipe.map((line) => {
          const found = materials.filter((material) => material.is_active && (material.id === line.material || lower(material.name) === lower(line.material) || (material.internal_reference && lower(material.internal_reference) === lower(line.material))));
          if (found.length !== 1) throw new McpToolError(found.length ? `Plusieurs matières correspondent à « ${line.material} ».` : `Aucune matière active ne correspond à « ${line.material} ».`);
          let quantity: number;
          try { quantity = parseQuantityToMilliunits(line.quantity); } catch { throw new McpToolError(`Quantité invalide pour « ${line.material} ».`); }
          return { material_id: found[0].id, quantity_milliunits: quantity };
        });
        if (new Set(lines.map((line) => line.material_id)).size !== lines.length) throw new McpToolError("Chaque matière ne peut apparaître qu’une fois dans la recette.");
      }
      const p = parseOrFail(productSchema, { productId: current.id, name: data.name ?? current.name, sku: data.sku ?? current.sku ?? "", category: data.category ?? current.category, salePrice: data.sale_price ?? euros(current.sale_price_cents), laborMinutes: data.labor_minutes ?? current.labor_minutes, packagingCost: data.packaging_cost ?? (current.packaging_cost_cents === null ? "" : euros(current.packaging_cost_cents)), materialLossPercent: data.material_loss_percent ?? current.material_loss_basis_points / 100, notes: data.notes ?? current.notes ?? "", isActive: data.active ?? current.is_active });
      await rpc(supabase, "save_product_with_recipe", { p_product_id: current.id, p_business_id: businessId, p_name: p.name, p_sku: p.sku || null, p_category: p.category, p_sale_price_cents: p.salePrice, p_labor_minutes: p.laborMinutes, p_packaging_cost_cents: p.packagingCost === "" ? null : p.packagingCost, p_material_loss_basis_points: p.materialLossPercent, p_notes: p.notes || null, p_is_active: p.isActive, p_lines: lines.map((line, index) => ({ ...line, position: index + 1 })) }, "La modification du produit");
      return { modifie: true, nom: p.name, prix_de_vente: formatEuroCents(p.salePrice), actif: p.isActive };
    },
  },
  {
    name: "archive_product",
    kind: "destructive",
    title: "Archiver un produit",
    description: "Archive un produit : il n’est plus proposé à la vente, l’historique des ventes est conservé.",
    input: z.object({ product: z.string().trim().min(1).max(160), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const key = (input as { product: string }).product;
      const found = (await listProducts(businessId, {})).filter((product) => product.id === key || lower(product.name) === lower(key) || (product.sku && lower(product.sku) === lower(key)));
      if (found.length !== 1) throw new McpToolError(found.length ? "Plusieurs produits correspondent : précisez l’identifiant." : `Aucun produit ne correspond à « ${key} ».`);
      await rpc(supabase, "archive_product", { p_product_id: found[0].id, p_business_id: businessId }, "L’archivage du produit");
      return { archive: true, nom: found[0].name };
    },
  },
  {
    name: "archive_material",
    kind: "destructive",
    title: "Archiver une matière",
    description: "Archive une matière : elle n’est plus proposée dans les recettes, les recettes existantes restent lisibles.",
    input: z.object({ material: z.string().trim().min(1).max(160).describe("Identifiant, référence ou nom exact."), confirmation }),
    run: async (input, { supabase, businessId }) => {
      const key = (input as { material: string }).material;
      const found = (await listMaterials(businessId)).filter((material) => material.is_active && (material.id === key || lower(material.name) === lower(key) || (material.internal_reference && lower(material.internal_reference) === lower(key))));
      if (found.length !== 1) throw new McpToolError(found.length ? "Plusieurs matières correspondent : précisez la référence." : `Aucune matière active ne correspond à « ${key} ».`);
      await rpc(supabase, "archive_material", { p_material_id: found[0].id, p_business_id: businessId }, "L’archivage de la matière");
      return { archivee: true, nom: found[0].name };
    },
  },
  {
    name: "update_material_category",
    kind: "write",
    title: "Modifier une catégorie de matière",
    description: "Renomme une catégorie de matière ou change son préfixe. Les références déjà attribuées ne sont pas renommées.",
    input: z.object({ category: z.string().trim().min(1).max(60).describe("Identifiant ou nom actuel."), name: z.string().trim().min(1).max(60).optional(), reference_prefix: z.string().trim().max(10).optional() }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { category: string; name?: string; reference_prefix?: string };
      const current = (await listMaterialCategories(businessId)).find((category) => category.id === data.category || lower(category.name) === lower(data.category));
      if (!current) throw new McpToolError(`Aucune catégorie de matière ne correspond à « ${data.category} ».`);
      const p = parseOrFail(materialCategorySchema, { categoryId: current.id, name: data.name ?? current.name, referencePrefix: data.reference_prefix ?? current.reference_prefix });
      await rpc(supabase, "update_material_category", { p_category_id: current.id, p_business_id: businessId, p_name: p.name, p_reference_prefix: p.referencePrefix }, "La modification de la catégorie");
      return { modifiee: true, nom: p.name, prefixe_reference: p.referencePrefix };
    },
  },
  {
    name: "get_costing_settings",
    title: "Paramètres de coût",
    description: "Taux horaire de main-d’œuvre et coût d’emballage par défaut utilisés pour estimer le coût des produits.",
    input: z.object({}),
    run: async (_input, { businessId }) => {
      const settings = await getCostingSettings(businessId);
      return { taux_horaire: formatEuroCents(settings.labor_hourly_rate_cents), emballage_par_defaut: formatEuroCents(settings.default_packaging_cost_cents) };
    },
  },
  {
    name: "update_costing_settings",
    kind: "write",
    title: "Modifier les paramètres de coût",
    description: "Modifie le taux horaire de main-d’œuvre et/ou le coût d’emballage par défaut. Les coûts estimés des produits sont recalculés.",
    input: z.object({ labor_hourly_rate: amount("Taux horaire").optional(), default_packaging_cost: amount("Emballage par défaut").optional() }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { labor_hourly_rate?: string; default_packaging_cost?: string };
      const current = await getCostingSettings(businessId);
      const p = parseOrFail(costingSettingsSchema, { laborHourlyRate: data.labor_hourly_rate ?? euros(current.labor_hourly_rate_cents), defaultPackagingCost: data.default_packaging_cost ?? euros(current.default_packaging_cost_cents) });
      await rpc(supabase, "update_costing_settings", { p_business_id: businessId, p_labor_hourly_rate_cents: p.laborHourlyRate, p_default_packaging_cost_cents: p.defaultPackagingCost }, "La modification des paramètres de coût");
      return { modifie: true, taux_horaire: formatEuroCents(p.laborHourlyRate), emballage_par_defaut: formatEuroCents(p.defaultPackagingCost) };
    },
  },
];

export const managementTools: McpTool<McpToolContext>[] = [...saleTools, ...invoiceTools, ...expenseTools, ...supplierAndRecurringTools, ...catalogTools];
