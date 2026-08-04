import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { formatEuro } from "@/lib/utils/format";

const metrics = ["Chiffre d’affaires encaissé", "Dépenses", "Cotisations estimées"];

export default async function DashboardPage() {
  const { context } = await getAuthenticatedContext();
  const firstName = context.profile?.first_name || "Bienvenue";
  return <><header className="page-header"><div><p className="eyebrow">Tableau de bord</p><h1>{firstName === "Bienvenue" ? firstName : `Bonjour ${firstName}`}</h1><p>{context.business?.name}</p></div><span className="status-badge">✓ Configuration terminée</span></header><section className="metric-grid" aria-label="Indicateurs">{metrics.map((label) => <Card key={label}><p>{label}</p><strong>{formatEuro(0)}</strong><small>Aucune donnée pour le moment</small></Card>)}<Card><p>Justificatifs manquants</p><strong>0</strong><small>Tout est à jour</small></Card></section><EmptyState title="Votre activité commence ici" description="Vos données apparaîtront sur ce tableau de bord après l’ajout de vos premières opérations." /></>;
}
