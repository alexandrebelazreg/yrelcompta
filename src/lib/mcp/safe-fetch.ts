import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { McpToolError } from "./protocol";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

const privateIpv4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** Adresse non publique (réseau local, boucle, lien local, métadonnées cloud, réservée…). */
export function isNonPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const value = ipv4ToNumber(ip);
    return privateIpv4.some(([base, bits]) => (value >>> (32 - bits)) === (ipv4ToNumber(base) >>> (32 - bits)));
  }
  const normalized = ip.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isNonPublicAddress(mapped[1]);
  return normalized === "::" || normalized === "::1" || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || normalized.startsWith("64:ff9b:") || normalized.startsWith("2001:db8:") || normalized.startsWith("ff");
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new McpToolError("Seules les adresses https:// sont acceptées.");
  if (url.username || url.password) throw new McpToolError("L’adresse ne doit pas contenir d’identifiants.");
  if (url.port && url.port !== "443") throw new McpToolError("L’adresse doit utiliser le port https standard.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((entry) => entry.address);
  if (addresses.length === 0) throw new McpToolError("Cette adresse est introuvable.");
  if (addresses.some(isNonPublicAddress)) throw new McpToolError("Cette adresse pointe vers un réseau privé : elle est refusée.");
}

/**
 * Télécharge une image publique en https, sans suivre de redirection non vérifiée, avec une taille
 * et une durée plafonnées. Chaque saut de redirection est revérifié (pas d'adresse privée).
 */
export async function fetchPublicFile(rawUrl: string, maxBytes: number): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new McpToolError("L’adresse de l’image est invalide.");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1" } });
    } catch {
      throw new McpToolError("L’image n’a pas pu être téléchargée (site injoignable ou trop lent).");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new McpToolError("Le site a renvoyé une redirection invalide.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) throw new McpToolError(`Le site a refusé le téléchargement (code ${response.status}).`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new McpToolError(`Image trop lourde (plus de ${Math.round(maxBytes / 1024)} Ko).`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new McpToolError(`Image trop lourde (plus de ${Math.round(maxBytes / 1024)} Ko).`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  throw new McpToolError("Trop de redirections.");
}
