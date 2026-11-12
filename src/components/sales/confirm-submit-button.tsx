"use client";

import { useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { PendingLabel } from "@/components/ui/pending-label";

/**
 * Bouton d’envoi réservé aux actions irréversibles : ouvre une fenêtre de confirmation
 * intégrée à l’application (à la place de `window.confirm`), avec « Annuler » focalisé par défaut.
 */
export function ConfirmSubmitButton({ children, message, danger = false }: { children: string; message: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasPendingRef = useRef(false);
  const messageId = useId();
  const buttonClass = danger ? "button danger-button" : "button";

  // Après un envoi (succès sans redirection ou erreur), la fenêtre se referme pour laisser voir le résultat.
  useEffect(() => {
    if (wasPendingRef.current && !pending) dialogRef.current?.close();
    wasPendingRef.current = pending;
  }, [pending]);

  function open() {
    // Les champs obligatoires sont vérifiés avant de demander la confirmation.
    const form = triggerRef.current?.form;
    if (form && !form.reportValidity()) return;
    dialogRef.current?.showModal();
  }

  return <>
    <button ref={triggerRef} className={buttonClass} type="button" disabled={pending} onClick={open}>{children}</button>
    <dialog ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-describedby={messageId} aria-label={children}
      onClick={(event) => { if (event.target === event.currentTarget && !pending) event.currentTarget.close(); }}
      onCancel={(event) => { if (pending) event.preventDefault(); }}>
      <div className="confirm-dialog-panel">
        <p id={messageId}>{message}</p>
        <div className="confirm-dialog-actions">
          <button className="secondary-link" type="button" autoFocus disabled={pending} onClick={() => dialogRef.current?.close()}>Annuler</button>
          <button className={buttonClass} type="submit" disabled={pending} aria-busy={pending}><PendingLabel pending={pending}>{children}</PendingLabel></button>
        </div>
      </div>
    </dialog>
  </>;
}
