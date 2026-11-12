/** Ce que le connecteur permet aujourd'hui, affiché à l'identique sur le consentement et dans les paramètres. */
export const connectorPermissions = [
  "Lire vos matières, catégories, produits, fournisseurs, charges récurrentes et votre rentabilité",
  "Créer et modifier vos matières et catégories de matières",
  "Créer des fournisseurs, des produits avec leur recette et des charges récurrentes",
  "Préparer des dépenses en brouillon, que vous vérifiez et validez vous-même",
];

export const connectorLimits = [
  "Valider une dépense, enregistrer un paiement ou un remboursement",
  "Supprimer quoi que ce soit",
  "Accéder aux ventes, factures, encaissements et justificatifs",
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
