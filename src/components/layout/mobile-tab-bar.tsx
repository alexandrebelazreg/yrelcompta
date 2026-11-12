"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { signOutAction } from "@/app/actions";
import { Icon } from "@/components/ui/icon";
import { useSheetDrag } from "@/components/ui/use-sheet-drag";

const primaryTabs = [
  ["/tableau-de-bord", "Synthèse", "dashboard"], ["/ventes", "Ventes", "sales"], ["/depenses", "Dépenses", "expenses"], ["/produits", "Produits", "products"],
] as const;

const moreLinks = [
  ["/factures", "Factures", "invoices"], ["/rentabilite", "Rentabilité", "profitability"], ["/documents", "Documents", "documents"],
  ["/registres", "Registres", "registers"], ["/parametres", "Paramètres", "settings"],
] as const;

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Barre d’onglets fixe en bas d’écran sur mobile : 4 destinations principales et « Plus » pour le reste. */
export function MobileTabBar({ email, businessName }: { email: string | null; businessName: string }) {
  const pathname = usePathname();
  const sheetRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => sheetRef.current?.close();
  const { handleProps } = useSheetDrag(panelRef, { canDismiss: () => true, close });
  const moreIsCurrent = moreLinks.some(([href]) => isCurrent(pathname, href));

  return <>
    <nav className="mobile-tab-bar" aria-label="Navigation principale">
      {primaryTabs.map(([href, label, icon]) => <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined}><span aria-hidden="true"><Icon name={icon} /></span>{label}</Link>)}
      <button type="button" aria-haspopup="dialog" aria-current={moreIsCurrent ? "page" : undefined} onClick={() => sheetRef.current?.showModal()}><span aria-hidden="true"><Icon name="more" /></span>Plus</button>
    </nav>
    <dialog ref={sheetRef} className="sheet-dialog" aria-label="Plus de rubriques"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={panelRef} className="sheet-panel">
        <div className="sheet-handle" {...handleProps}><span className="sheet-grabber" aria-hidden="true" /><h2>Plus</h2></div>
        <nav className="sheet-links" aria-label="Autres rubriques">
          {moreLinks.map(([href, label, icon]) => <Link key={href} href={href} onClick={close} aria-current={isCurrent(pathname, href) ? "page" : undefined}><span aria-hidden="true"><Icon name={icon} /></span>{label}</Link>)}
        </nav>
        <form action={signOutAction} className="sheet-account">
          <span><strong>{businessName}</strong><small>{email}</small></span>
          <button className="secondary-link" type="submit">Se déconnecter</button>
        </form>
      </div>
    </dialog>
  </>;
}
