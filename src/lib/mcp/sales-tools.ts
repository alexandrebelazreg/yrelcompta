import "server-only";
import { z } from "zod";
import { loadAllDashboardPages } from "@/lib/dashboard/pagination";
import { billingCommercialStateLabels, billingCustomerKindLabels, billingDocumentKindLabels } from "@/lib/invoicing/labels";
import { getBillingDocument, getInvoiceForSale, listBillingDocuments } from "@/lib/invoicing/queries";
import { listProducts } from "@/lib/products/queries";
import { calculateSaleFinancials, calculateSalesTotals, formatEuroCents, toSafeIntegerAmount } from "@/lib/sales/calculations";
import { paymentMethodLabels, refundKindLabels, saleChannelLabels, saleStatusLabels } from "@/lib/sales/labels";
import { getSale, listSales } from "@/lib/sales/queries";
import { saleFormSchema } from "@/lib/sales/validation";
import { getTodayInParis } from "@/lib/utils/date";
import type { BillingDocument } from "@/types/invoicing";
import type { Sale, SaleChannel, SaleStatus } from "@/types/sales";
import type { McpToolContext } from "./auth";
import { McpToolError, type McpTool } from "./protocol";

const isoDate = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${label} au format AAAA-MM-JJ.`);
const listing = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => `${key} = ${label}`).join(", ");
const channel = z.enum(["direct", "market", "instagram", "etsy", "website", "shopify", "retailer", "other"]).describe(`Canal : ${listing(saleChannelLabels)}.`);
const lower = (value: string) => value.trim().toLocaleLowerCase("fr");

function saleSummary(sale: Sale) {
  const financials = calculateSaleFinancials(sale);
  return {
    id: sale.id,
    reference: sale.reference,
    date: sale.ordered_on,
    canal: saleChannelLabels[sale.channel],
    cliente: sale.customer_name,
    statut: saleStatusLabels[sale.status],
    total: formatEuroCents(sale.total_cents),
    encaisse_net: formatEuroCents(financials.netCollectedCents),
    reste_a_encaisser: formatEuroCents(financials.remainingCents),
    marge_de_fabrication: sale.costing_complete && sale.manufacturing_margin_cents !== null ? formatEuroCents(sale.manufacturing_margin_cents) : null,
  };
}

/** Facture ou avoir, sans l'adresse, l'e-mail ni les identifiants de l'acheteur (données de tiers). */
function documentSummary(document: BillingDocument) {
  return {
    id: document.id,
    type: billingDocumentKindLabels[document.kind],
    numero: document.number,
    emis_le: document.issuedOn,
    vente: document.saleReference,
    acheteur: document.buyerName,
    type_acheteur: billingCustomerKindLabels[document.buyerKind],
    total_ht: formatEuroCents(document.totalExclTaxCents),
    tva: formatEuroCents(document.vatCents),
    total_ttc: formatEuroCents(document.totalInclTaxCents),
    echeance_paiement: document.paymentDueOn,
    etat: billingCommercialStateLabels[document.commercialState],
    facture_d_origine: document.originalInvoiceNumber,
    motif_avoir: document.creditReason,
  };
}

/** Retrouve une vente par identifiant ou par référence (V-2026-0001). */
export async function findSale(businessId: string, key: string): Promise<Sale> {
  const id = z.string().uuid().safeParse(key).success ? key : (await listSales(businessId, { search: key })).find((sale) => lower(sale.reference) === lower(key))?.id;
  const sale = id ? await getSale(businessId, id) : null;
  if (!sale) throw new McpToolError(`Aucune vente ne correspond à « ${key} ».`);
  return sale;
}

export const saleItemInput = z.object({
  product: z.string().trim().max(160).optional().describe("Identifiant, SKU ou nom exact d’un produit du catalogue ; son prix est utilisé si unit_price est absent."),
  description: z.string().trim().max(300).optional().describe("Libellé de la ligne ; le nom du produit par défaut."),
  quantity: z.number().int().min(1).max(999).default(1),
  unit_price: z.union([z.string().trim().max(20), z.number().nonnegative()]).transform(String).optional().describe("Prix unitaire TTC en euros, ex. \"45\"."),
});

/** Transforme les lignes saisies par Claude en lignes du formulaire de vente (produit du catalogue ou ligne libre). */
export async function resolveSaleItems(businessId: string, items: Array<{ product?: string; description?: string; quantity: number; unit_price?: string }>) {
  const products = items.some((item) => item.product) ? await listProducts(businessId, { active: "active" }) : [];
  return items.map((item) => {
    const product = item.product ? products.find((candidate) => candidate.id === item.product || lower(candidate.name) === lower(item.product ?? "") || (candidate.sku && lower(candidate.sku) === lower(item.product ?? ""))) : undefined;
    if (item.product && !product) throw new McpToolError(`Aucun produit actif ne correspond à « ${item.product} ». Consultez list_products.`);
    const description = item.description || product?.name;
    if (!description) throw new McpToolError("Chaque ligne doit avoir un produit ou une description.");
    const unitPrice = item.unit_price ?? (product ? (product.sale_price_cents / 100).toFixed(2) : undefined);
    if (!unitPrice) throw new McpToolError(`Indiquez le prix unitaire de « ${description} ».`);
    return { description, quantity: item.quantity, unitPrice, productId: product?.id ?? null };
  });
}

export const salesReadTools: McpTool<McpToolContext>[] = [
  {
    name: "list_sales",
    title: "Ventes",
    description: "Liste les ventes (100 plus récentes au plus) avec total, encaissement et marge de fabrication. Filtres : statut, canal, période, cliente ou référence.",
    input: z.object({
      status: z.enum(["draft", "validated", "cancelled"]).optional().describe(`Statut : ${listing(saleStatusLabels)}.`),
      channel: channel.optional(),
      from: isoDate("Début de période (incluse)").optional(),
      to: isoDate("Fin de période (incluse)").optional(),
      search: z.string().trim().max(80).optional().describe("Référence de vente ou nom de cliente."),
    }),
    run: async (input, { businessId }) => {
      const { status, channel: saleChannel, from, to, search } = input as { status?: SaleStatus; channel?: SaleChannel; from?: string; to?: string; search?: string };
      const sales = await listSales(businessId, { status, channel: saleChannel, search });
      return sales.filter((sale) => (!from || sale.ordered_on >= from) && (!to || sale.ordered_on <= to)).map(saleSummary);
    },
  },
  {
    name: "get_sale",
    title: "Détail d’une vente",
    description: "Détail d’une vente : lignes, frais de port, remise, encaissements, remboursements et facture éventuelle.",
    input: z.object({ sale: z.string().trim().min(1).max(80).describe("Identifiant ou référence de la vente.") }),
    run: async (input, { businessId }) => {
      const { sale: key } = input as { sale: string };
      const sale = await findSale(businessId, key);
      const invoice = sale.status === "validated" ? await getInvoiceForSale(businessId, sale.id) : null;
      return {
        ...saleSummary(sale),
        sous_total: formatEuroCents(sale.subtotal_cents),
        frais_de_port: formatEuroCents(sale.shipping_cents),
        remise: formatEuroCents(sale.discount_cents),
        notes: sale.notes,
        motif_annulation: sale.cancellation_reason,
        lignes: sale.sale_items.map((item) => ({ description: item.description, quantite: item.quantity, prix_unitaire: formatEuroCents(item.unit_price_cents), total: formatEuroCents(item.line_total_cents), produit: item.product_name_snapshot ?? item.product?.name ?? null })),
        encaissements: sale.payments.map((payment) => ({ id: payment.id, date: payment.received_on, moyen: paymentMethodLabels[payment.method], brut: formatEuroCents(payment.gross_amount_cents), commission: formatEuroCents(payment.platform_fee_cents), net_verse: formatEuroCents(payment.net_deposit_cents), remboursements: payment.refunds.map((refund) => ({ id: refund.id, date: refund.refunded_on, montant: formatEuroCents(refund.amount_cents), type: refundKindLabels[refund.kind], motif: refund.reason })) })),
        facture: invoice ? { numero: invoice.number, emise_le: invoice.issuedOn, etat: billingCommercialStateLabels[invoice.commercialState] } : null,
      };
    },
  },
  {
    name: "get_sales_summary",
    title: "Bilan des ventes",
    description: "Bilan des ventes validées commandées sur une période (le mois en cours par défaut) : nombre, chiffre d’affaires, encaissé, commissions, remboursements, reste à encaisser et marge de fabrication. Estimation interne, ni comptable ni fiscale.",
    input: z.object({ from: isoDate("Début de période (incluse)").optional(), to: isoDate("Fin de période (incluse)").optional() }),
    run: async (input, { supabase, businessId }) => {
      const today = getTodayInParis();
      const { from = `${today.slice(0, 7)}-01`, to = today } = input as { from?: string; to?: string };
      if (from > to) throw new McpToolError("La date de début doit précéder la date de fin.");
      const rows = await loadAllDashboardPages(async (start, end) => {
        const { data, error } = await supabase.from("sales")
          .select("status,total_cents,manufacturing_margin_cents,costing_complete,payments(gross_amount_cents,platform_fee_cents,refunds(amount_cents))")
          .eq("business_id", businessId).eq("status", "validated").gte("ordered_on", from).lte("ordered_on", to)
          .order("id").range(start, end);
        return { data: data as unknown as Array<Record<string, unknown>> | null, error };
      }, (code) => console.error("Bilan des ventes du connecteur impossible", { code }));
      const sales = rows.map((row) => ({
        status: row.status as SaleStatus,
        total_cents: toSafeIntegerAmount(row.total_cents),
        payments: ((row.payments ?? []) as Array<Record<string, unknown>>).map((payment) => ({
          gross_amount_cents: toSafeIntegerAmount(payment.gross_amount_cents),
          platform_fee_cents: toSafeIntegerAmount(payment.platform_fee_cents),
          refunds: ((payment.refunds ?? []) as Array<Record<string, unknown>>).map((refund) => ({ amount_cents: toSafeIntegerAmount(refund.amount_cents) })),
        })),
      }));
      const totals = calculateSalesTotals(sales);
      const withMargin = rows.filter((row) => row.costing_complete === true && row.manufacturing_margin_cents !== null);
      const margin = withMargin.reduce((sum, row) => sum + BigInt(toSafeIntegerAmount(row.manufacturing_margin_cents)), BigInt(0));
      return {
        periode: { du: from, au: to },
        ventes_validees: rows.length,
        chiffre_affaires: formatEuroCents(totals.validatedSalesCents),
        encaisse_brut: formatEuroCents(totals.grossPaidCents),
        commissions: formatEuroCents(totals.platformFeesCents),
        rembourse: formatEuroCents(totals.refundedCents),
        encaisse_net: formatEuroCents(totals.netCollectedCents),
        reste_a_encaisser: formatEuroCents(totals.remainingCents),
        marge_de_fabrication: formatEuroCents(toSafeIntegerAmount(margin)),
        ventes_avec_cout_complet: withMargin.length,
      };
    },
  },
  {
    name: "list_invoices",
    title: "Factures et avoirs",
    description: "Liste les factures et avoirs émis (numéro, date, acheteur, montants, état). Sans adresse ni e-mail des acheteurs.",
    input: z.object({
      year: z.number().int().min(2000).max(2100).optional().describe("Année d’émission."),
      kind: z.enum(["invoice", "credit_note"]).optional().describe("invoice = factures, credit_note = avoirs."),
      search: z.string().trim().max(80).optional().describe("Numéro, référence de vente ou nom d’acheteur."),
    }),
    run: async (input, { businessId }) => (await listBillingDocuments(businessId, input as { year?: number; kind?: "invoice" | "credit_note"; search?: string })).map(documentSummary),
  },
  {
    name: "get_invoice",
    title: "Détail d’une facture",
    description: "Détail d’une facture ou d’un avoir : lignes, montants, échéance et avoirs liés. Sans adresse ni e-mail de l’acheteur.",
    input: z.object({ invoice: z.string().trim().min(1).max(80).describe("Identifiant ou numéro de la facture ou de l’avoir.") }),
    run: async (input, { businessId }) => {
      const { invoice: key } = input as { invoice: string };
      const id = z.string().uuid().safeParse(key).success ? key : (await listBillingDocuments(businessId, { search: key })).find((document) => lower(document.number) === lower(key))?.id;
      const found = id ? await getBillingDocument(businessId, id) : null;
      if (!found) throw new McpToolError(`Aucune facture ni aucun avoir ne correspond à « ${key} ».`);
      const { document } = found;
      return {
        ...documentSummary(document),
        livraison_le: document.supplyOn,
        sous_total_ht: formatEuroCents(document.subtotalExclTaxCents),
        frais_de_port_ht: formatEuroCents(document.shippingExclTaxCents),
        remise_ht: formatEuroCents(document.discountExclTaxCents),
        mention_tva: document.vatExemptionMentionSnapshot,
        lignes: document.items.map((item) => ({ description: item.description, quantite: item.quantity, prix_unitaire_ht: formatEuroCents(item.unitPriceExclTaxCents), total_ht: formatEuroCents(item.lineTotalExclTaxCents) })),
        avoirs: document.credits.map((credit) => ({ numero: credit.number, emis_le: credit.issuedOn, total_ttc: formatEuroCents(credit.totalInclTaxCents) })),
      };
    },
  },
];

export const salesWriteTools: McpTool<McpToolContext>[] = [
  {
    name: "create_sale_draft",
    kind: "write",
    title: "Créer une vente en brouillon",
    description: "Prépare une vente en BROUILLON (lignes, frais de port, remise). L’utilisatrice la vérifie et la valide elle-même dans YrelCompta ; encaissements et factures se font ensuite dans l’application.",
    input: z.object({
      ordered_on: isoDate("Date de commande").optional(),
      channel,
      customer_name: z.string().trim().max(160).optional().describe("Nom de la cliente, facultatif."),
      items: z.array(saleItemInput).min(1).max(200),
      shipping: z.union([z.string().trim().max(20), z.number().nonnegative()]).transform(String).optional().describe("Frais de port facturés, en euros."),
      discount: z.union([z.string().trim().max(20), z.number().nonnegative()]).transform(String).optional().describe("Remise totale, en euros."),
      notes: z.string().trim().max(2000).optional(),
    }),
    run: async (input, { supabase, businessId, origin }) => {
      const data = input as { ordered_on?: string; channel: SaleChannel; customer_name?: string; items: Array<{ product?: string; description?: string; quantity: number; unit_price?: string }>; shipping?: string; discount?: string; notes?: string };
      const items = await resolveSaleItems(businessId, data.items);
      const parsed = saleFormSchema.safeParse({ orderedOn: data.ordered_on ?? getTodayInParis(), channel: data.channel, customerName: data.customer_name ?? "", notes: data.notes ?? "", shipping: data.shipping ?? "", discount: data.discount ?? "", items });
      if (!parsed.success) throw new McpToolError(`Données invalides : ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "entrée"} — ${issue.message}`).join(" ; ")}`);
      const p = parsed.data;
      const { data: id, error } = await supabase.rpc("create_sale_draft", { p_business_id: businessId, p_ordered_on: p.orderedOn, p_channel: p.channel, p_customer_name: p.customerName || null, p_notes: p.notes || null, p_shipping_cents: p.shipping, p_discount_cents: p.discount, p_items: p.items.map((item) => ({ description: item.description, quantity: item.quantity, unit_price_cents: item.unitPrice, product_id: item.productId ?? null })) });
      if (error) {
        console.error("Brouillon de vente du connecteur refusé", { code: error.code });
        if (error.code === "42501") throw new McpToolError("Accès refusé à cette entreprise.");
        if (error.code === "22003") throw new McpToolError("Le montant dépasse la limite autorisée.");
        throw new McpToolError("La vente a été refusée par YrelCompta : vérifiez les montants, la date et les produits.");
      }
      return { cree: true, statut: "brouillon", id: String(id), a_valider_ici: `${origin}/ventes/${id}`, rappel: "La vente est en brouillon : vérifiez-la et validez-la dans YrelCompta, puis enregistrez l’encaissement et la facture si besoin." };
    },
  },
];
