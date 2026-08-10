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

Le Client Secret et le token Shopify ne sont jamais stockés dans une table publique. La migration les chiffre avec Supabase Vault via `vault.create_secret` et les fait tourner avec `vault.update_secret`.

Le backend utilise `SUPABASE_SECRET_KEY`, attendu au format `sb_secret_*`, dans un client marqué `server-only`. Cette clé emploie le rôle Postgres `service_role`, contourne RLS et reste limitée aux RPC internes suivantes : lecture Vault, cache du token et réception des webhooks. Les actions utilisateur ordinaires continuent d’utiliser leur session et les RPC contrôlées par `assert_expense_manager`.

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

Le Route Handler Node lit les octets bruts, calcule le HMAC-SHA256 avec le Client Secret et effectue une comparaison en temps constant avant tout `JSON.parse`. Une livraison valide enregistre uniquement les en-têtes utiles, les identifiants Shopify minimaux et le SHA-256 du payload. Le payload complet, les noms, emails, téléphones et adresses ne sont pas persistés. La contrainte `(connection_id, webhook_id)` rend les redeliveries idempotentes.

## Limite comptable volontaire

Cette PR ne crée, ne modifie et ne valide aucune vente, aucun encaissement et aucun remboursement YrelCompta. Les événements restent au statut `pending` pour la prochaine étape : relire les commandes Shopify par GraphQL, puis produire une vente YrelCompta selon des règles métier relues séparément.

Références : [Client Credentials Grant Shopify](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant), [vérification des webhooks Shopify](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [clés Supabase publishable et secret](https://supabase.com/docs/guides/getting-started/api-keys).
