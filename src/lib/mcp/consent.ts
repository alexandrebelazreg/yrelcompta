/** Ce que le connecteur permet aujourd'hui, affiché à l'identique sur le consentement et dans les paramètres. */
export const connectorPermissions = [
  "Lire vos matières, catégories, produits, fournisseurs, charges récurrentes et votre rentabilité",
  "Lire vos ventes, encaissements, factures et avoirs (nom des acheteurs, sans adresse ni e-mail)",
  "Créer et modifier vos matières et catégories de matières",
  "Créer des fournisseurs, des produits avec leur recette et des charges récurrentes",
  "Préparer des ventes et des dépenses en brouillon, que vous vérifiez et validez vous-même",
];

export const connectorLimits = [
  "Valider une vente ou une dépense, enregistrer un encaissement, un paiement ou un remboursement",
  "Émettre une facture ou un avoir, annuler une vente",
  "Supprimer quoi que ce soit, ou consulter vos justificatifs",
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
