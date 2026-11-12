"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icon";

const VISIBLE_MS = 4500;

/**
 * Confirmation temporaire d’une action réussie (paramètre `?message=` posé par une redirection) :
 * elle s’annonce aux lecteurs d’écran, disparaît seule, et le paramètre est retiré de l’URL
 * pour ne pas réapparaître au rafraîchissement ou au retour arrière.
 */
export function FlashToast({ message }: { message: string }) {
  const flag = useSearchParams().get("message");
  const [previousFlag, setPreviousFlag] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  // Un nouveau `?message=` (même identique au précédent après nettoyage de l’URL) réaffiche la notification.
  if (flag !== previousFlag) {
    setPreviousFlag(flag);
    if (flag) setVisible(true);
  }

  useEffect(() => {
    if (!flag) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("message");
    window.history.replaceState(window.history.state, "", url);
  }, [flag]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return <div className="flash-toast-region" role="status" aria-live="polite">
    {visible && <div className="flash-toast">
      <Icon name="check" />
      <p>{message}</p>
      <button type="button" aria-label="Masquer la notification" onClick={() => setVisible(false)}><Icon name="close" /></button>
    </div>}
  </div>;
}
