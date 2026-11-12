"use client";

import { useRef, type PointerEvent, type RefObject } from "react";

/** Projection de l’élan (formule de décélération exponentielle utilisée par le défilement iOS). */
export function projectMomentum(velocityPxPerSecond: number, decelerationRate = 0.998) {
  return (velocityPxPerSecond / 1000) * decelerationRate / (1 - decelerationRate);
}

/** Résistance progressive au-delà de la limite (vers le haut) au lieu d’un arrêt sec. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Décide, au relâchement, si la feuille doit se fermer : on regarde où le geste allait, pas où il s’arrête. */
export function shouldDismissSheet(offset: number, velocity: number, height: number) {
  if (velocity < -300) return false;
  return offset + projectMomentum(velocity) > height * 0.5;
}

const SNAP_BACK = "transform .35s cubic-bezier(.2, .8, .2, 1)";
const DISMISS = "transform .22s cubic-bezier(.4, 0, 1, 1)";

/**
 * Glisser une feuille vers le bas pour la fermer (mobile uniquement) : suivi 1:1 du doigt,
 * élan projeté au relâchement, retour amorti sinon. `canDismiss` renvoie `false` pour refuser
 * la fermeture (par exemple une saisie en cours) : la feuille revient alors en place.
 * Sinon la feuille finit de sortir par le bas, puis `close` est appelé.
 */
export function useSheetDrag(panelRef: RefObject<HTMLElement | null>, { canDismiss, close }: { canDismiss: () => boolean; close: () => void }) {
  const drag = useRef<{ startY: number; samples: Array<{ y: number; t: number }> } | null>(null);

  function setTransform(value: string, transition: string) {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = transition;
    panel.style.transform = value;
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!window.matchMedia("(max-width: 700px)").matches || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, samples: [{ y: event.clientY, t: event.timeStamp }] };
    setTransform("translateY(0)", "none");
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    const panel = panelRef.current;
    if (!state || !panel) return;
    const delta = event.clientY - state.startY;
    const offset = delta >= 0 ? delta : rubberband(delta, panel.offsetHeight);
    state.samples = [...state.samples.slice(-4), { y: event.clientY, t: event.timeStamp }];
    setTransform(`translateY(${offset}px)`, "none");
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!state || !panel) return;
    const offset = Math.max(0, event.clientY - state.startY);
    const first = state.samples[0];
    const elapsed = Math.max(1, event.timeStamp - first.t);
    const velocity = ((event.clientY - first.y) / elapsed) * 1000;

    if (shouldDismissSheet(offset, velocity, panel.offsetHeight) && canDismiss()) {
      setTransform("translateY(100%)", DISMISS);
      window.setTimeout(() => { close(); setTransform("", ""); }, 220);
      return;
    }
    setTransform("translateY(0)", SNAP_BACK);
  }

  function reset() { setTransform("", ""); }

  return { reset, handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
