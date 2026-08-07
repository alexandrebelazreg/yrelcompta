import { getAuthenticatedContext } from "@/lib/auth/context";
import { deterministicPdfFilename } from "@/lib/invoicing/calculations";
import { generateBillingPdf } from "@/lib/invoicing/pdf";
import { getBillingDocument } from "@/lib/invoicing/queries";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { context }] = await Promise.all([params, getAuthenticatedContext()]);
  if (!context.business) return new Response("Non autorisé", { status: 401 });
  const data = await getBillingDocument(context.business.id, id);
  if (!data) return new Response("Document introuvable", { status: 404 });
  const bytes = await generateBillingPdf(data.document);
  return new Response(bytes as BodyInit, { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${deterministicPdfFilename(data.document.kind, data.document.number)}"`,
  } });
}
