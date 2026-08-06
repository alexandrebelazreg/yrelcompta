"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/tableau-de-bord", "Tableau de bord", "⌂"], ["/ventes", "Ventes", "↗"],
  ["/depenses", "Dépenses", "↙"], ["/produits", "Produits", "◇"],
  ["/documents", "Documents", "▤"], ["/registres", "Registres", "▦"],
  ["/parametres", "Paramètres", "⚙"],
];

export function Navigation() {
  const pathname = usePathname();
  return <nav className="app-nav" aria-label="Navigation de l’application">{links.map(([href, label, icon]) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}</Link>)}</nav>;
}
