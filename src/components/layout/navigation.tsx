"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";

const links: Array<[string, string, IconName]> = [
  ["/tableau-de-bord", "Tableau de bord", "dashboard"], ["/ventes", "Ventes", "sales"], ["/factures", "Factures", "invoices"],
  ["/depenses", "Dépenses", "expenses"], ["/produits", "Produits", "products"], ["/rentabilite", "Rentabilité", "profitability"],
  ["/documents", "Documents", "documents"], ["/registres", "Registres", "registers"],
  ["/parametres", "Paramètres", "settings"],
];

/** Icône du lien : passe en état « en cours » dès le clic, avant même la fin de la navigation. */
function NavIcon({ icon }: { icon: IconName }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={pending ? "is-pending" : undefined}><Icon name={icon} /></span>;
}

export function Navigation() {
  const pathname = usePathname();
  return <nav className="app-nav" aria-label="Navigation de l’application">{links.map(([href, label, icon]) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}><NavIcon icon={icon} />{label}</Link>)}</nav>;
}
