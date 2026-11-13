/** Ce que le connecteur permet aujourd'hui, affiché à l'identique sur le consentement et dans les paramètres. */
export const connectorPermissions = [
  "Lire toutes vos données : matières, produits, fournisseurs, charges, dépenses, ventes, factures et rentabilité (acheteurs cités par leur nom, sans coordonnées)",
  "Créer et modifier vos matières, catégories, produits, fournisseurs, charges récurrentes et paramètres de coût",
  "Préparer, modifier ou supprimer des ventes et des dépenses en brouillon",
  "Avec votre confirmation explicite : valider une vente ou une dépense, enregistrer un encaissement, un paiement ou un remboursement",
  "Avec votre confirmation explicite : émettre une facture ou un avoir, annuler une vente ou une dépense, archiver un élément",
];

export const connectorLimits = [
  "Agir sans votre accord : Claude vous demande l’autorisation avant chaque modification",
  "Modifier une vente, une dépense ou une facture déjà validée : la correction passe toujours par un remboursement, un avoir ou une annulation tracés",
  "Consulter vos justificatifs, vos paramètres légaux de facturation ou votre profil fiscal",
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
