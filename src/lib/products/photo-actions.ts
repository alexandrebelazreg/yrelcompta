"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isMaterialPhotoMime, MATERIAL_PHOTO_BUCKET, materialPhotoPath } from "./material-photos";

export type MaterialPhotoResult = { ok: true } | { ok: false; error: string };

async function ctx() {
  const { userId, context } = await getAuthenticatedContext();
  const supabase = await createClient();
  if (!userId || !context.business || !supabase) return null;
  return { supabase, businessId: context.business.id };
}

const input = z.object({ materialId: z.string().uuid(), photoId: z.string().uuid().nullable(), mimeType: z.string().refine(isMaterialPhotoMime).nullable() });

function refresh() {
  revalidatePath("/produits/matieres");
  revalidatePath("/produits", "layout");
}

/**
 * Associe à la matière la vignette que le navigateur vient d'envoyer (photoId + type), ou retire
 * la photo (photoId null). L'ancienne vignette est ensuite effacée du Storage privé.
 */
export async function setMaterialPhotoAction(raw: z.input<typeof input>): Promise<MaterialPhotoResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success || (parsed.data.photoId === null) !== (parsed.data.mimeType === null)) return { ok: false, error: "Photo invalide." };
  const c = await ctx();
  if (!c) return { ok: false, error: "Session expirée : reconnectez-vous." };
  const { materialId, photoId, mimeType } = parsed.data;
  const path = photoId && mimeType && isMaterialPhotoMime(mimeType) ? materialPhotoPath(c.businessId, materialId, photoId, mimeType) : null;
  const { data: previous, error } = await c.supabase.rpc("set_material_photo", { p_material_id: materialId, p_business_id: c.businessId, p_photo_path: path });
  if (error) {
    console.error("Photo de matière refusée", { code: error.code });
    if (path) await c.supabase.storage.from(MATERIAL_PHOTO_BUCKET).remove([path]);
    return { ok: false, error: error.code === "42501" ? "Vous n’avez pas l’autorisation de modifier cette matière." : "La photo n’a pas pu être enregistrée." };
  }
  if (typeof previous === "string" && previous) {
    const removed = await c.supabase.storage.from(MATERIAL_PHOTO_BUCKET).remove([previous]);
    if (removed.error) console.error("Ancienne photo de matière non effacée", { code: removed.error.name });
  }
  refresh();
  return { ok: true };
}
