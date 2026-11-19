/** Vignette carrée d'une matière, ou un emplacement neutre sans photo. */
export function MaterialThumb({ url, name, size = "small" }: { url?: string | null; name: string; size?: "small" | "medium" }) {
  return (
    <span className={`material-thumb material-thumb-${size}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- lien signé privé et temporaire, non optimisable par next/image */}
      {url ? <img src={url} alt={`Photo de ${name}`} loading="lazy" decoding="async"/> : <span aria-hidden="true">·</span>}
    </span>
  );
}
