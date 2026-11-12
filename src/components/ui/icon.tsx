import type { ReactNode } from "react";

/** Jeu d’icônes au trait, dessiné sur une grille 24 × 24 : même épaisseur et même style partout. */
const paths = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  sales: <><path d="M6 3 3.5 6.5V20a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V6.5L18 3Z" /><path d="M3.5 6.5h17" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  invoices: <><path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-12Z" /><path d="M14.5 2.5v5h5" /><path d="M8.5 13h7M8.5 17h7M8.5 9h2" /></>,
  expenses: <><path d="M5 2.5v19l2.3-1.3 2.4 1.3 2.3-1.3 2.3 1.3 2.4-1.3 2.3 1.3v-19l-2.3 1.3-2.4-1.3-2.3 1.3-2.3-1.3-2.4 1.3Z" /><path d="M9 8.5h6M9 12h6M9 15.5h4" /></>,
  products: <><path d="M6.5 3.5h11l3.5 5.5-9 11.5L3 9Z" /><path d="M3 9h18" /><path d="m10.5 3.5-2 5.5 3.5 11.5 3.5-11.5-2-5.5" /></>,
  profitability: <><path d="m2.5 17 6-6 4 4 8.5-8.5" /><path d="M15.5 6.5h5.5V12" /></>,
  documents: <path d="M3 6.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  registers: <><path d="M2.5 4h6a3.5 3.5 0 0 1 3.5 3.5V20a2.5 2.5 0 0 0-2.5-2.5h-7Z" /><path d="M21.5 4h-6A3.5 3.5 0 0 0 12 7.5V20a2.5 2.5 0 0 1 2.5-2.5h7Z" /></>,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  check: <path d="M20 6.5 9.5 17 4 11.5" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={["icon", className].filter(Boolean).join(" ")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
