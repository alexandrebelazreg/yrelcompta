import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup }));

const { fetchPublicFile, isNonPublicAddress } = await import("./safe-fetch");

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  dns.lookup.mockReset();
  dns.lookup.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
});
afterEach(() => vi.unstubAllGlobals());

describe("téléchargement d’images publiques", () => {
  it("classe les adresses privées, locales et réservées", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isNonPublicAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isNonPublicAddress(ip), ip).toBe(false);
  });

  it("refuse http, les identifiants et les ports non standard sans rien télécharger", async () => {
    await expect(fetchPublicFile("http://exemple.fr/a.png", 1000)).rejects.toThrow("https");
    await expect(fetchPublicFile("https://moi:secret@exemple.fr/a.png", 1000)).rejects.toThrow("identifiants");
    await expect(fetchPublicFile("https://exemple.fr:8443/a.png", 1000)).rejects.toThrow("port");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un nom qui pointe vers un réseau privé", async () => {
    dns.lookup.mockResolvedValue([{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    await expect(fetchPublicFile("https://interne.example/a.png", 1000)).rejects.toThrow("réseau privé");
    await expect(fetchPublicFile("https://169.254.169.254/latest/meta-data", 1000)).rejects.toThrow("réseau privé");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revérifie chaque redirection", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } }));
    await expect(fetchPublicFile("https://exemple.fr/a.png", 1000)).rejects.toThrow("réseau privé");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("plafonne la taille téléchargée", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(2000)));
    await expect(fetchPublicFile("https://exemple.fr/a.png", 1000)).rejects.toThrow("trop lourde");
  });

  it("renvoie le contenu d’une image publique", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    await expect(fetchPublicFile("https://exemple.fr/a.png", 1000)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });
});
