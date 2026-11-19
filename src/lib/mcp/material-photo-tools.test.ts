import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ listMaterials: vi.fn(), fetchPublicFile: vi.fn() }));
vi.mock("@/lib/products/queries", () => ({ listMaterials: mocks.listMaterials }));
vi.mock("./safe-fetch", () => ({ fetchPublicFile: mocks.fetchPublicFile }));

const { materialPhotoTools } = await import("./material-photo-tools");
const { handleMcpMessage } = await import("./protocol");

const BIZ = "11111111-1111-4111-8111-111111111111";
const MAT = "22222222-2222-4222-8222-222222222222";
const OLD = `${BIZ}/${MAT}/33333333-3333-4333-8333-333333333333.webp`;
const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 data");
const material = (overrides: Record<string, unknown> = {}) => ({ id: MAT, name: "Perle nacre", internal_reference: "PE-001", is_active: true, photo_path: null, ...overrides });

let rpc: ReturnType<typeof vi.fn>;
let upload: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
async function call(args: Record<string, unknown>) {
  const context = { supabase: { rpc, storage: { from: () => ({ upload, remove }) } }, userId: "u", businessId: BIZ, businessName: "B", clientId: "c", origin: "https://x.example" };
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_material_photo", arguments: args } }, materialPhotoTools, context as never) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  return { isError: Boolean(response.result.isError), text: response.result.content[0].text };
}

beforeEach(() => {
  rpc = vi.fn(async () => ({ data: OLD, error: null }));
  upload = vi.fn(async () => ({ data: {}, error: null }));
  remove = vi.fn(async () => ({ data: [], error: null }));
  mocks.listMaterials.mockResolvedValue([material()]);
  mocks.fetchPublicFile.mockResolvedValue(webp);
});

describe("photo d’une matière (connecteur)", () => {
  it("envoie une vignette base64, l’associe à la matière et efface l’ancienne", async () => {
    const result = await call({ material: "pe-001", image_base64: Buffer.from(webp).toString("base64") });
    expect(result.isError).toBe(false);
    const [path, body, options] = upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${BIZ}/${MAT}/[0-9a-f-]{36}\\.webp$`));
    expect(body).toEqual(webp);
    expect(options).toEqual({ contentType: "image/webp", upsert: false });
    expect(rpc).toHaveBeenCalledWith("set_material_photo", { p_material_id: MAT, p_business_id: BIZ, p_photo_path: path });
    expect(remove).toHaveBeenCalledWith([OLD]);
    expect(JSON.parse(result.text)).toMatchObject({ photo: true, remplacee: true });
  });

  it("télécharge une image depuis une adresse https", async () => {
    await call({ material: "Perle nacre", image_url: "https://fournisseur.example/perle.webp" });
    expect(mocks.fetchPublicFile).toHaveBeenCalledWith("https://fournisseur.example/perle.webp", 1_048_576);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("accepte une matière archivée", async () => {
    mocks.listMaterials.mockResolvedValue([material({ is_active: false })]);
    expect((await call({ material: "PE-001", image_base64: Buffer.from(webp).toString("base64") })).isError).toBe(false);
  });

  it("retire la photo sans rien envoyer", async () => {
    await call({ material: "PE-001", remove: true });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("set_material_photo", { p_material_id: MAT, p_business_id: BIZ, p_photo_path: null });
    expect(remove).toHaveBeenCalledWith([OLD]);
  });

  it("refuse un fichier qui n’est pas une image autorisée", async () => {
    const result = await call({ material: "PE-001", image_base64: Buffer.from("%PDF-1.7 pas une image").toString("base64") });
    expect(result.isError).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it("exige exactement un choix", async () => {
    expect((await call({ material: "PE-001" })).isError).toBe(true);
    expect((await call({ material: "PE-001", remove: true, image_url: "https://a.example/x.png" })).isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("efface la vignette envoyée si l’enregistrement est refusé", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "invalid photo path" } });
    const result = await call({ material: "PE-001", image_base64: Buffer.from(webp).toString("base64") });
    expect(result.isError).toBe(true);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });
});
