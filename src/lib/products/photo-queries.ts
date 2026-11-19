import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Material } from "@/types/products";
import { MATERIAL_PHOTO_BUCKET } from "./material-photos";

/** Durée des liens signés des vignettes : assez pour une séance de travail, jamais permanents. */
const PHOTO_URL_SECONDS = 3600;

/** Ajoute à chaque matière un lien signé temporaire vers sa vignette (null sans photo). */
export async function withMaterialPhotoUrls<T extends Material>(materials: T[]): Promise<T[]> {
  const paths = materials.flatMap((material) => material.photo_path ? [material.photo_path] : []);
  if (paths.length === 0) return materials.map((material) => ({ ...material, photo_url: null }));
  const supabase = await createClient();
  const urls = new Map<string, string>();
  if (supabase) {
    const { data, error } = await supabase.storage.from(MATERIAL_PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
    if (error) console.error("Liens des photos de matières indisponibles", { code: error.name });
    for (const entry of data ?? []) if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  return materials.map((material) => ({ ...material, photo_url: material.photo_path ? urls.get(material.photo_path) ?? null : null }));
}
