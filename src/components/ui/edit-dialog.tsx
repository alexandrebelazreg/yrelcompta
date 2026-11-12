"use client";

import { useRef, useState, type ReactNode } from "react";
import { useSheetDrag } from "./use-sheet-drag";

/**
 * Bouton « Modifier » ouvrant le formulaire dans une fenêtre centrée plutôt que dans la ligne du tableau.
 * Si une saisie est en cours, toute fermeture (fond, Échap, ×) demande d’abord une confirmation
 * pour ne jamais perdre des modifications par inadvertance.
 */
export function EditDialog({ title, label = "Modifier", children }: { title: string; label?: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dirtyRef = useRef(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Sur mobile, la fenêtre est une feuille : glisser l’en-tête vers le bas la ferme, sauf saisie en cours.
  const { handleProps } = useSheetDrag(panelRef, {
    canDismiss: () => { if (dirtyRef.current) { setConfirmingDiscard(true); return false; } return true; },
    close: () => dialogRef.current?.close(),
  });

  function open() {
    dirtyRef.current = false;
    setConfirmingDiscard(false);
    dialogRef.current?.showModal();
  }

  function requestClose() {
    if (dirtyRef.current) { setConfirmingDiscard(true); return; }
    dialogRef.current?.close();
  }

  function discard() {
    dialogRef.current?.querySelectorAll("form").forEach((form) => form.reset());
    dirtyRef.current = false;
    setConfirmingDiscard(false);
    dialogRef.current?.close();
  }

  return <>
    <button className="table-action-link" type="button" onClick={open}>{label}</button>
    <dialog
      ref={dialogRef}
      className="edit-dialog"
      aria-label={title}
      // Un clic sur le fond (en dehors du panneau) ferme la fenêtre, sauf saisie en cours.
      onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
      // Échap : même règle que le fond.
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
    >
      <div
        ref={panelRef}
        className="edit-dialog-panel"
        onInput={() => { dirtyRef.current = true; }}
        onChange={() => { dirtyRef.current = true; }}
        // Une fois envoyée, la saisie n’est plus considérée comme en cours.
        onSubmit={() => { dirtyRef.current = false; setConfirmingDiscard(false); }}
      >
        <header className="edit-dialog-header" {...handleProps}>
          <span className="sheet-grabber" aria-hidden="true" />
          <h2>{title}</h2>
          <button className="edit-dialog-close" type="button" aria-label="Fermer" onClick={requestClose}>×</button>
        </header>
        {confirmingDiscard && <div className="discard-banner" role="alert">
          <p>Vos modifications ne sont pas enregistrées.</p>
          <div>
            <button className="secondary-link" type="button" autoFocus onClick={() => setConfirmingDiscard(false)}>Continuer la saisie</button>
            <button className="button danger-button" type="button" onClick={discard}>Abandonner</button>
          </div>
        </div>}
        {children}
      </div>
    </dialog>
  </>;
}
