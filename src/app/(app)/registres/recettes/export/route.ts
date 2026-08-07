import type { NextRequest } from "next/server";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createCsv, formatCentsForCsv } from "@/lib/registers/csv";
import { resolveRegisterYear } from "@/lib/registers/calculations";
import { getRevenueRegister } from "@/lib/registers/queries";
import { paymentMethodLabels, saleChannelLabels } from "@/lib/sales/labels";
import { formatFrenchDate } from "@/lib/utils/format";

export async function GET(request: NextRequest) {
  const { context } = await getAuthenticatedContext();
  if (!context.business) return new Response("Non autorisé", { status: 401 });
  const year = resolveRegisterYear(request.nextUrl.searchParams.get("annee") ?? undefined);
  try {
    const { entries } = await getRevenueRegister(context.business.id, year);
    const csv = createCsv(
      ["Date d'encaissement", "Origine", "Référence vente", "Canal", "Mode de règlement", "Référence de paiement", "Montant encaissé EUR", "Commission informative EUR", "Enregistré dans YrelCompta le"],
      entries.map((entry) => [
        entry.receivedOn,
        entry.origin,
        entry.saleReference,
        saleChannelLabels[entry.channel],
        paymentMethodLabels[entry.method],
        entry.paymentReference ?? "",
        formatCentsForCsv(entry.grossAmountCents),
        formatCentsForCsv(entry.platformFeeCents),
        formatFrenchDate(entry.createdAt),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="yrelcompta-livre-recettes-${year}.csv"`,
      },
    });
  } catch {
    return new Response("Export indisponible", { status: 500 });
  }
}
