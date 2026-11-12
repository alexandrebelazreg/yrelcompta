/** Ce que le connecteur permet aujourd'hui, affiché à l'identique sur le consentement et dans les paramètres. */
export const connectorPermissions = [
  "Lire vos matières, catégories de matières et fournisseurs",
  "Lire vos produits, leurs recettes et leurs coûts estimés",
  "Lire vos charges récurrentes et votre estimation de rentabilité",
];

export const connectorLimits = [
  "Aucune création, modification ni suppression : l’accès est en lecture seule",
  "Pas d’accès aux ventes, factures, encaissements ni justificatifs",
];

const TRUSTED_HOSTS = ["claude.ai", "claude.com", "anthropic.com"];

/** Domaine vers lequel l'utilisatrice sera renvoyée, et s'il appartient bien à Claude. */
export function describeRedirect(redirectUri: string): { host: string; trusted: boolean } {
  try {
    const { host, hostname, protocol } = new URL(redirectUri);
    const trusted = protocol === "https:" && TRUSTED_HOSTS.some((trustedHost) => hostname === trustedHost || hostname.endsWith(`.${trustedHost}`));
    return { host, trusted };
  } catch {
    return { host: redirectUri, trusted: false };
  }
}
