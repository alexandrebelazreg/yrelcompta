import { EmptyState } from "@/components/ui/empty-state";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return <><header className="page-header"><div><p className="eyebrow">YrelCompta</p><h1>{title}</h1><p>{description}</p></div></header><EmptyState title="Fonctionnalité en cours de construction" description="Cet espace est prêt à accueillir cette fonctionnalité dans une prochaine version." /></>;
}
