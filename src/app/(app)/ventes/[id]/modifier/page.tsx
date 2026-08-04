import { notFound, redirect } from "next/navigation";
import { SaleForm } from "@/components/sales/sale-form";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { getSale } from "@/lib/sales/queries";

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { context } = await getAuthenticatedContext(); if (!context.business) return null;
  const sale = await getSale(context.business.id, id); if (!sale) notFound();
  if (sale.status !== "draft") redirect(`/ventes/${id}?erreur=Une vente validée ou annulée ne peut plus être modifiée.`);
  return <><header className="page-header"><div><p className="eyebrow">{sale.reference}</p><h1>Modifier le brouillon</h1><p>Les lignes et les totaux seront remplacés atomiquement.</p></div></header><SaleForm sale={sale} /></>;
}
