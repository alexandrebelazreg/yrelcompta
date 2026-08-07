import { z } from "zod";
import { calculateSaleSubtotal, parseFrenchMoneyToCents } from "./calculations";

const moneySchema = z.string().trim().min(1, "Le montant est requis.").transform((value, context) => {
  try { return parseFrenchMoneyToCents(value); } catch { context.addIssue({ code: "custom", message: "Saisissez un montant positif avec deux décimales maximum." }); return z.NEVER; }
});
const optionalMoneySchema = z.string().trim().transform((value, context) => {
  if (!value) return 0;
  try { return parseFrenchMoneyToCents(value); } catch { context.addIssue({ code: "custom", message: "Saisissez un montant positif avec deux décimales maximum." }); return z.NEVER; }
});

export const saleItemSchema = z.object({
  description: z.string().trim().min(1, "La description est requise.").max(300),
  quantity: z.coerce.number().int().min(1).max(999),
  unitPrice: moneySchema,
  productId: z.union([z.uuid("L’identifiant du produit est invalide."), z.null()]).optional(),
}).strict();
export const saleFormSchema = z.object({
  saleId: z.string().uuid().optional(), orderedOn: z.iso.date("La date de commande est invalide."),
  channel: z.enum(["direct", "market", "instagram", "etsy", "website", "shopify", "retailer", "other"]),
  customerName: z.string().trim().max(160), notes: z.string().trim().max(2000), shipping: optionalMoneySchema, discount: optionalMoneySchema,
  items: z.array(saleItemSchema).min(1, "Ajoutez au moins une ligne.").max(200),
}).refine((data) => {
  try { return data.discount <= calculateSaleSubtotal(data.items.map((item) => ({ quantity: item.quantity, unit_price_cents: item.unitPrice }))) + data.shipping; }
  catch { return false; }
}, { path: ["discount"], message: "La remise dépasse le total avant remise." })
  .refine((data) => {
  try {
    const subtotal = calculateSaleSubtotal(data.items.map((item) => ({ quantity: item.quantity, unit_price_cents: item.unitPrice })));
    return Number.isSafeInteger(subtotal + data.shipping - data.discount);
  } catch { return false; }
  }, { path: ["items"], message: "Le total dépasse la limite monétaire autorisée." });

export const paymentFormSchema = z.object({
  saleId: z.string().uuid(), receivedOn: z.iso.date("La date d’encaissement est invalide."), bankDepositedOn: z.union([z.literal(""), z.iso.date()]),
  grossAmount: moneySchema.refine((value) => value > 0, "Le montant doit être supérieur à zéro."), platformFee: optionalMoneySchema,
  method: z.enum(["cash", "card", "bank_transfer", "paypal", "stripe", "sumup", "etsy", "cheque", "other"]),
  externalReference: z.string().trim().max(200), notes: z.string().trim().max(2000),
}).refine((data) => data.platformFee <= data.grossAmount, { path: ["platformFee"], message: "La commission ne peut pas dépasser le montant brut." })
  .refine((data) => !data.bankDepositedOn || data.bankDepositedOn >= data.receivedOn, { path: ["bankDepositedOn"], message: "La date de versement ne peut pas précéder l’encaissement." });

export const refundFormSchema = z.object({ paymentId: z.string().uuid(), saleId: z.string().uuid(), refundedOn: z.iso.date("La date de remboursement est invalide."), amount: moneySchema.refine((value) => value > 0), kind: z.enum(["customer_refund", "correction"]), reason: z.string().trim().min(2, "Le motif est obligatoire.").max(500) });
export const cancellationSchema = z.object({ saleId: z.string().uuid(), reason: z.string().trim().min(2, "Le motif est obligatoire.").max(500) });

export interface SalesActionState { error?: string; fieldErrors?: Record<string, string[]>; }
