import { SaleForm } from "@/components/sales/sale-form";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { listSaleProductOptions } from "@/lib/sales/queries";

export default async function NewSalePage() {
  const { context } = await getAuthenticatedContext();
  if (!context.business) return null;
  const products = await listSaleProductOptions(context.business.id);
  return <><header className="page-header"><div><p className="eyebrow">Ventes</p><h1>Nouvelle vente</h1><p>Enregistrez les informations de la commande. Les totaux seront recalculés par la base de données.</p></div></header><SaleForm products={products} /></>;
}
