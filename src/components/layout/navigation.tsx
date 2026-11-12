"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/tableau-de-bord", "Tableau de bord", "⌂"], ["/ventes", "Ventes", "↗"], ["/factures", "Factures", "▧"],
  ["/depenses", "Dépenses", "↙"], ["/produits", "Produits", "◇"], ["/rentabilite", "Rentabilité", "◎"],
  ["/documents", "Documents", "▤"], ["/registres", "Registres", "▦"],
  ["/parametres", "Paramètres", "⚙"],
];

/** Icône du lien : passe en état « en cours » dès le clic, avant même la fin de la navigation. */
function NavIcon({ icon }: { icon: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={pending ? "is-pending" : undefined}>{icon}</span>;
}

export function Navigation() {
  const pathname = usePathname();
  return <nav className="app-nav" aria-label="Navigation de l’application">{links.map(([href, label, icon]) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}><NavIcon icon={icon} />{label}</Link>)}</nav>;
}
