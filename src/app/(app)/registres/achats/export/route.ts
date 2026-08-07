import type { NextRequest } from "next/server";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { expensePaymentMethodLabels } from "@/lib/expenses/labels";
import { resolveRegisterYear } from "@/lib/registers/calculations";
import { createCsv, formatCentsForCsv } from "@/lib/registers/csv";
import { getPurchaseRegister } from "@/lib/registers/queries";
import { formatFrenchDate } from "@/lib/utils/format";

export async function GET(request: NextRequest) {
  const { context } = await getAuthenticatedContext();
  if (!context.business) return new Response("Non autorisé", { status: 401 });
  const year = resolveRegisterYear(request.nextUrl.searchParams.get("annee") ?? undefined);
  try {
    const { entries } = await getPurchaseRegister(context.business.id, year);
    const csv = createCsv(
      ["Date du règlement", "Référence dépense", "Description", "Mode de règlement", "Référence fournisseur / justificatif", "Référence du paiement", "Montant réglé EUR", "Part professionnelle suivie EUR", "Enregistré dans YrelCompta le"],
      entries.map((entry) => [
        entry.paidOn,
        entry.expenseReference,
        entry.description,
        expensePaymentMethodLabels[entry.method],
        entry.supplierReference ?? "",
        entry.paymentReference ?? "",
        formatCentsForCsv(entry.amountCents),
        formatCentsForCsv(entry.businessAmountCents),
        formatFrenchDate(entry.createdAt),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="yrelcompta-registre-achats-${year}.csv"`,
      },
    });
  } catch {
    return new Response("Export indisponible", { status: 500 });
  }
}
