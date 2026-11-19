import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectMaterialPhotoMime, materialPhotoPath } from "./material-photos";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261119140000_material_photos.sql"), "utf8");
const sql = migration.replace(/\s+/g, " ");
const section = (start: string, end: string) => sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start)));

describe("photos des matières : migration", () => {
  it("crée un bucket privé limité aux vignettes", () => {
    expect(sql).toContain("values('material-photos','material-photos',false,1048576,array['image/webp','image/jpeg','image/png'])");
    expect(sql).toContain("on conflict(id) do update set public=false");
  });

  it("rattache le chemin de la photo à l’entreprise et à la matière", () => {
    expect(sql).toContain("split_part(photo_path,'/',1)=business_id::text and split_part(photo_path,'/',2)=id::text");
    const rpc = section("create function public.set_material_photo(", "end $$;");
    expect(rpc).toContain("public.assert_product_manager(p_business_id)");
    expect(rpc).toContain("split_part(p_photo_path,'/',2)<>p_material_id::text");
    expect(rpc).toContain("return previous;");
  });

  it("réserve l’envoi aux gestionnaires et protège la photo en cours", () => {
    expect(section("create policy material_photos_storage_insert", ");")).toContain("public.can_manage_business(m.business_id)");
    expect(section("create policy material_photos_storage_select", ");")).toContain("public.is_business_member(b.id)");
    expect(section("create policy material_photos_storage_delete", ");")).toContain("not exists(select 1 from public.materials m where m.photo_path=objects.name)");
    expect(migration).not.toMatch(/to anon/i);
  });
});

describe("photos des matières : chemins et formats", () => {
  it("construit le chemin attendu par la base", () => {
    expect(materialPhotoPath("b", "m", "p", "image/jpeg")).toBe("b/m/p.jpg");
  });

  it("reconnaît les formats à leurs premiers octets", () => {
    expect(detectMaterialPhotoMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectMaterialPhotoMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe("image/jpeg");
    expect(detectMaterialPhotoMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(detectMaterialPhotoMime(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });
});
