/**
 * Libellé de bouton qui garde sa largeur pendant l’envoi : le texte reste en place (invisible)
 * et un indicateur s’affiche par-dessus, avec une annonce pour les lecteurs d’écran.
 */
export function PendingLabel({ pending, children }: { pending: boolean; children: string }) {
  return <span className={pending ? "pending-label is-pending" : "pending-label"}>
    <span className="pending-label-text">{children}</span>
    {pending && <><span className="pending-label-spinner" aria-hidden="true" /><span className="sr-only">Veuillez patienter…</span></>}
  </span>;
}
