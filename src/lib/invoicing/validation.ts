import { z } from "zod";
import { parseFrenchMoneyToCents } from "@/lib/sales/calculations";

/** Schémas partagés par les actions de facturation et le connecteur Claude. */
export const nullableText = (max: number) => z.string().trim().max(max);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const professionalBuyerSirenMessage = "Le SIREN à 9 chiffres est obligatoire pour un client professionnel dans la facturation V1.";
export const invoiceSchema = z.object({
  saleId: z.string().uuid(), supplyOn: dateSchema, operationCategory: z.enum(["goods", "services", "mixed"]),
  buyerKind: z.enum(["individual", "professional"]), buyerName: z.string().trim().min(1).max(200),
  buyerAddress: nullableText(1000), buyerAddressOmitted: z.boolean(), buyerBillingAddress: nullableText(1000),
  buyerDeliveryAddress: nullableText(1000), buyerEmail: nullableText(254), buyerSiren: z.string().trim().refine((value) => value === "" || /^\d{9}$/.test(value)),
  buyerVatNumber: nullableText(50), purchaseOrderReference: nullableText(200), paymentDueOn: dateSchema,
}).superRefine((value, context) => {
  if (value.buyerKind === "professional" && !/^\d{9}$/.test(value.buyerSiren)) {
    context.addIssue({ code: "custom", path: ["buyerSiren"], message: professionalBuyerSirenMessage });
  }
});
export const creditSchema = z.object({
  invoiceId: z.string().uuid(), amount: z.string().min(1).transform((value, context) => {
    try { return parseFrenchMoneyToCents(value); } catch { context.addIssue({ code: "custom", message: "Montant invalide" }); return z.NEVER; }
  }),
  reason: z.string().trim().min(2).max(500), linkedRefundId: z.string().trim().refine((value) => value === "" || z.uuid().safeParse(value).success),
});

