/**
 * Chemin de retour après connexion, limité au site lui-même pour éviter toute redirection ouverte.
 * Seuls les chemins internes connus sont acceptés.
 */
const ALLOWED_PREFIXES = ["/oauth/consent", "/tableau-de-bord", "/ventes", "/factures", "/depenses", "/produits", "/rentabilite", "/documents", "/registres", "/parametres"];

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://yrelcompta.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://yrelcompta.invalid") return null;
  if (!ALLOWED_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return null;
  return `${url.pathname}${url.search}`;
}
