"use client";

import { useRef, type ReactNode } from "react";

/** Bouton « Modifier » ouvrant le formulaire dans une fenêtre centrée plutôt que dans la ligne du tableau. */
export function EditDialog({ title, label = "Modifier", children }: { title: string; label?: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return <>
    <button className="table-action-link" type="button" onClick={() => dialogRef.current?.showModal()}>{label}</button>
    <dialog
      ref={dialogRef}
      className="edit-dialog"
      aria-label={title}
      // Un clic sur le fond (en dehors du panneau) ferme la fenêtre.
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
    >
      <div className="edit-dialog-panel">
        <header className="edit-dialog-header">
          <h2>{title}</h2>
          <button className="edit-dialog-close" type="button" aria-label="Fermer" onClick={() => dialogRef.current?.close()}>×</button>
        </header>
        {children}
      </div>
    </dialog>
  </>;
}
