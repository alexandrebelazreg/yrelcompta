"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { setMaterialPhotoAction } from "@/lib/products/photo-actions";
import { isMaterialPhotoMime, MATERIAL_PHOTO_BUCKET, MATERIAL_PHOTO_MAX_SIDE, MAX_MATERIAL_PHOTO_BYTES, materialPhotoPath, type MaterialPhotoMime } from "@/lib/products/material-photos";
import { createClient } from "@/lib/supabase/client";

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}

/** Réduit la photo dans le navigateur (480 px de côté au plus), en WebP si possible, sinon en JPEG. */
async function makeThumbnail(file: File): Promise<{ blob: Blob; mime: MaterialPhotoMime }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MATERIAL_PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const type of ["image/webp", "image/jpeg"]) {
    const blob = await toBlob(canvas, type);
    if (blob && blob.type === type && isMaterialPhotoMime(blob.type)) return { blob, mime: blob.type };
  }
  throw new Error("THUMBNAIL_FAILED");
}

export function MaterialPhotoField({ businessId, materialId, materialName, photoUrl }: { businessId: string; materialId: string; materialName: string; photoUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      let thumbnail: { blob: Blob; mime: MaterialPhotoMime };
      try {
        thumbnail = await makeThumbnail(file);
      } catch {
        setError("Cette image n’a pas pu être lue. Essayez une photo JPEG, PNG ou WebP.");
        return;
      }
      if (thumbnail.blob.size > MAX_MATERIAL_PHOTO_BYTES) { setError("La vignette dépasse 1 Mio."); return; }
      const photoId = crypto.randomUUID();
      const upload = await createClient().storage.from(MATERIAL_PHOTO_BUCKET).upload(materialPhotoPath(businessId, materialId, photoId, thumbnail.mime), thumbnail.blob, { contentType: thumbnail.mime, upsert: false });
      if (upload.error) { setError("L’envoi de la photo a été refusé."); return; }
      const result = await setMaterialPhotoAction({ materialId, photoId, mimeType: thumbnail.mime });
      if (!result.ok) { setError(result.error); return; }
      setPreview(URL.createObjectURL(thumbnail.blob));
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await setMaterialPhotoAction({ materialId, photoId: null, mimeType: null });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setPreview(null);
    router.refresh();
  }

  const shown = preview ?? photoUrl;
  const inputId = `material-photo-${materialId}`;
  return (
    <div className="material-photo-field">
      <div className="material-photo-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- lien signé privé et temporaire, non optimisable par next/image */}
        {shown ? <img src={shown} alt={`Photo de ${materialName}`}/> : <span aria-hidden="true">Pas de photo</span>}
      </div>
      <div className="material-photo-actions">
        <label className="secondary-link" htmlFor={inputId} aria-disabled={busy}>{busy ? "Envoi…" : shown ? "Changer la photo" : "Ajouter une photo"}</label>
        <input ref={input} className="sr-only" id={inputId} type="file" accept="image/*" disabled={busy} onChange={(event) => void choose(event.currentTarget.files?.[0])}/>
        {shown && <button className="secondary-link danger-text" type="button" disabled={busy} onClick={() => void remove()}>Retirer</button>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
