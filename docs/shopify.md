# Fondation Shopify V1

Cette première intégration relie une entreprise YrelCompta à une boutique appartenant à la même organisation Shopify. Elle ne synchronise encore aucune donnée comptable.

## Connexion et authentification

L’utilisateur renseigne le domaine de sa boutique, le Client ID et le Client Secret dans **Paramètres > Shopify**. Le domaine est normalisé vers `*.myshopify.com` et strictement validé avant toute requête afin d’éviter les cibles arbitraires et les SSRF.

L’authentification Shopify est isolée dans `src/lib/shopify/auth.ts`. Elle utilise le Client Credentials Grant et la GraphQL Admin API stable `2026-07`. Ce mode est réservé aux apps et boutiques détenues par la même organisation Shopify. Une évolution OAuth pourra remplacer cette couche sans modifier le reste de l’intégration.

Les permissions obligatoires sont limitées à :

- `read_orders` ;
- `read_products`.

La V1 ne demande ni `write_orders` ni `read_all_orders`.

## Secrets, Vault et client Supabase serveur

Le Client Secret et le token Shopify ne sont jamais stockés dans une table publique. La migration les chiffre avec Supabase Vault. Le token est renouvelé avec `vault.update_secret`. Une rotation d’identifiants crée un nouveau secret courant et conserve l’ancien comme secret précédent pendant 65 minutes, afin d’accepter les webhooks que Shopify peut encore signer avec l’ancienne valeur pendant une heure. Une rotation suivante supprime d’abord ce précédent : il n’existe jamais de chaîne de secrets.

Le backend utilise `SUPABASE_SECRET_KEY`, attendu au format `sb_secret_*`, dans un client marqué `server-only`. Cette clé emploie le rôle Postgres `service_role`, contourne RLS et reste limitée aux RPC internes Shopify. Seule la RPC de statut nettoyé est exécutable par `authenticated`. Les Server Actions résolvent l’utilisateur et l’entreprise depuis la session, transmettent `p_actor`, puis chaque mutation backend revérifie directement dans `business_members` que cet acteur appartient à l’entreprise avec un rôle `owner` ou `member`.

Une boutique déjà connectée ne peut pas être changée depuis « Remplacer les identifiants ». Cette action ne fait tourner que le Client ID et le Client Secret. Pour relier une autre boutique, il faut d’abord déconnecter la connexion actuelle ; le refus intervient avant toute opération Vault ou modification des subscriptions.

Le token client-credentials expire après environ 24 heures (`expires_in = 86399`). `getShopifyAccessToken(connectionId)` réutilise le token chiffré lorsqu’il reste plus de cinq minutes, sinon il renouvelle le token et met à jour Vault. En cas de renouvellements concurrents, chaque token reste valide côté Shopify et la dernière écriture complète gagne sans produire d’état partiel.

## Webhooks

Les subscriptions shop-specific sont réconciliées via GraphQL pour l’URL construite depuis `NEXT_PUBLIC_SITE_URL` :

`/api/integrations/shopify/webhook`

Topics suivis :

- `ORDERS_CREATE` ;
- `ORDERS_UPDATED` ;
- `ORDERS_PAID` ;
- `ORDERS_CANCELLED` ;
- `REFUNDS_CREATE`.

La réconciliation liste les subscriptions de l’app, réutilise celles déjà exactes, met à jour une ancienne URL YrelCompta ou crée uniquement la subscription manquante. Elle ne supprime pas les webhooks sans rapport. La déconnexion tente de supprimer uniquement les GID enregistrés par YrelCompta ; si Shopify est indisponible, la connexion et ses secrets sont conservés pour permettre un nouvel essai.

Le Route Handler Node rejette un `Content-Length` supérieur à 5 Mio avant la lecture et lit ensuite le flux brut avec la même limite, sans allocation complète non bornée. La plateforme d’hébergement conserve également ses propres limites de requête. Le handler calcule le HMAC-SHA256 avec le secret courant puis, uniquement pendant la grâce, avec le secret précédent, en effectuant chaque comparaison en temps constant avant tout `JSON.parse`. Une livraison valide enregistre uniquement les en-têtes utiles, les identifiants Shopify minimaux et le SHA-256 du payload. Le payload complet, les noms, emails, téléphones et adresses ne sont pas persistés. La contrainte `(connection_id, webhook_id)` rend les redeliveries idempotentes.

## Limite comptable volontaire

Cette PR ne crée, ne modifie et ne valide aucune vente, aucun encaissement et aucun remboursement YrelCompta. Les événements restent au statut `pending` pour la prochaine étape : relire les commandes Shopify par GraphQL, puis produire une vente YrelCompta selon des règles métier relues séparément.

Références : [Client Credentials Grant Shopify](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant), [vérification des webhooks Shopify](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [clés Supabase publishable et secret](https://supabase.com/docs/guides/getting-started/api-keys).
