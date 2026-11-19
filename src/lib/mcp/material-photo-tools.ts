import "server-only";
import { z } from "zod";
import { detectMaterialPhotoMime, MATERIAL_PHOTO_BUCKET, materialPhotoPath, MAX_MATERIAL_PHOTO_BYTES } from "@/lib/products/material-photos";
import { listMaterials } from "@/lib/products/queries";
import type { Material } from "@/types/products";
import type { McpToolContext } from "./auth";
import { decodeInlineFile } from "./file-input";
import { McpToolError, type McpTool } from "./protocol";
import { fetchPublicFile } from "./safe-fetch";

const lower = (value: string) => value.trim().toLocaleLowerCase("fr");

/** Matière active ou archivée, par identifiant, référence ou nom exact ; une active l'emporte à égalité. */
function findAnyMaterial(materials: Material[], key: string): Material {
  const needle = lower(key);
  const candidates = materials.filter((material) => material.id === key || lower(material.name) === needle || (material.internal_reference && lower(material.internal_reference) === needle));
  const matches = candidates.length > 1 ? candidates.filter((material) => material.is_active) : candidates;
  if (matches.length === 1) return matches[0];
  if (candidates.length > 1) throw new McpToolError(`Plusieurs matières correspondent à « ${key} » : précisez l’identifiant ou la référence.`);
  throw new McpToolError(`Aucune matière ne correspond à « ${key} ». Consultez list_materials.`);
}

export const materialPhotoTools: McpTool<McpToolContext>[] = [
  {
    name: "set_material_photo",
    kind: "write",
    title: "Photo d’une matière",
    description: "Ajoute, remplace ou retire la photo d’une matière (active ou archivée). Fournir exactement un choix : image_base64 (vignette WebP, JPEG ou PNG de 1 Mio au plus, idéalement environ 10 Ko), image_url (adresse https publique d’une image) ou remove=true. La photo apparaît dans la liste des matières et dans le choix des matières des recettes.",
    input: z.object({
      material: z.string().trim().min(1).max(160).describe("Identifiant, référence ou nom exact de la matière."),
      image_base64: z.string().min(8).max(Math.ceil(MAX_MATERIAL_PHOTO_BYTES / 3) * 4 + 100).optional().describe("Image encodée en base64 (WebP, JPEG ou PNG)."),
      image_url: z.string().trim().url().max(2000).optional().describe("Adresse https publique de l’image (par exemple la photo produit du fournisseur)."),
      remove: z.literal(true).optional().describe("true pour retirer la photo actuelle."),
    }),
    run: async (input, { supabase, businessId }) => {
      const data = input as { material: string; image_base64?: string; image_url?: string; remove?: true };
      const choices = [data.image_base64 !== undefined, data.image_url !== undefined, data.remove === true].filter(Boolean).length;
      if (choices !== 1) throw new McpToolError("Fournissez exactement un choix : image_base64, image_url ou remove.");
      const material = findAnyMaterial(await listMaterials(businessId), data.material);

      let path: string | null = null;
      if (!data.remove) {
        const bytes = data.image_base64 !== undefined ? decodeInlineFile(data.image_base64) : await fetchPublicFile(data.image_url as string, MAX_MATERIAL_PHOTO_BYTES);
        if (bytes.byteLength === 0) throw new McpToolError("L’image est vide.");
        if (bytes.byteLength > MAX_MATERIAL_PHOTO_BYTES) throw new McpToolError("Image trop lourde (1 Mio au plus) : envoyez une vignette.");
        const mime = detectMaterialPhotoMime(bytes);
        if (!mime) throw new McpToolError("Ce fichier n’est pas une image WebP, JPEG ou PNG.");
        path = materialPhotoPath(businessId, material.id, crypto.randomUUID(), mime);
        const upload = await supabase.storage.from(MATERIAL_PHOTO_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
        if (upload.error) {
          console.error("Envoi de la photo de matière refusé", { code: upload.error.name });
          throw new McpToolError("L’envoi de la photo a été refusé par YrelCompta.");
        }
      }

      const { data: previous, error } = await supabase.rpc("set_material_photo", { p_material_id: material.id, p_business_id: businessId, p_photo_path: path });
      if (error) {
        console.error("Photo de matière refusée", { code: error.code });
        if (path) await supabase.storage.from(MATERIAL_PHOTO_BUCKET).remove([path]);
        if (error.code === "42501") throw new McpToolError("Accès refusé à cette entreprise.");
        throw new McpToolError("La photo n’a pas pu être enregistrée.");
      }
      if (typeof previous === "string" && previous) {
        const removed = await supabase.storage.from(MATERIAL_PHOTO_BUCKET).remove([previous]);
        if (removed.error) console.error("Ancienne photo de matière non effacée", { code: removed.error.name });
      }
      return { modifie: true, matiere: material.name, reference: material.internal_reference, photo: path !== null, remplacee: typeof previous === "string" && previous !== "" };
    },
  },
];
