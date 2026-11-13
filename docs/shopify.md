# Fondation Shopify V1

Cette première intégration relie une entreprise YrelCompta à une boutique appartenant à la même organisation Shopify. Elle ne synchronise encore aucune donnée comptable.

## Connexion et authentification

Le mode d’emploi destiné à l’utilisatrice (création de l’app dans le Dev Dashboard Shopify, permissions,
installation, identifiants et dépannage) est affiché directement dans **Paramètres > Shopify**
(`src/components/shopify/shopify-guide.tsx`). Depuis janvier 2026, les nouvelles apps personnalisées se créent
dans le Dev Dashboard (`dev.shopify.com`) et non plus depuis l’administration de la boutique.

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

La réconciliation liste les subscriptions de l’app, réutilise celles déjà exactes, met à jour une ancienne URL YrelCompta ou crée uniquement la subscription manquante. Elle ne supprime pas les webhooks sans rapport. Si une étape Shopify ou la persistance locale échoue, une RPC backend force immédiatement `connection_status = webhooks_partial` avec un code d’erreur interne ; une connexion précédemment complète ne reste donc pas affichée comme connectée.

Avant une déconnexion, YrelCompta relit obligatoirement les subscriptions live du shop et de l’app. La suppression cible l’union dédupliquée des GID enregistrés en base et des subscriptions live dont le topic fait partie des cinq topics YrelCompta et dont l’URI correspond exactement à l’endpoint configuré. Cela récupère les webhooks créés pendant une réconciliation interrompue sans toucher aux autres subscriptions. Si le listing live ou une suppression échoue, la connexion et ses secrets sont conservés pour permettre un nouvel essai.

Le Route Handler Node rejette un `Content-Length` supérieur à 5 Mio avant la lecture et lit ensuite le flux brut avec la même limite, sans allocation complète non bornée. La plateforme d’hébergement conserve également ses propres limites de requête. Le handler calcule le HMAC-SHA256 avec le secret courant puis, uniquement pendant la grâce, avec le secret précédent, en effectuant chaque comparaison en temps constant avant tout `JSON.parse`. Une livraison valide enregistre uniquement les en-têtes utiles, les identifiants Shopify minimaux et le SHA-256 du payload. Le payload complet, les noms, emails, téléphones et adresses ne sont pas persistés. La contrainte `(connection_id, webhook_id)` rend les redeliveries idempotentes.

## Import des commandes en ventes

### Synchronisation par l’API (sans webhooks)

Sur l’offre **Basic**, Shopify peut refuser les webhooks de commandes à une app marchande (pas d’accès aux
données clientes protégées de niveau 2). La connexion reste valable : le message renvoyé par Shopify est conservé
(`shopify_connections.last_webhook_error`) et affiché dans Paramètres > Shopify, et les commandes sont relues par
l’API, qui reste accessible au niveau 1 sans donnée personnelle.

- **Toutes les 15 minutes**, la fonction planifiée Netlify `netlify/functions/shopify-sync.mts` appelle
  `POST /api/integrations/shopify/sync`. L’appel est signé par un HMAC horodaté (5 minutes) calculé avec
  `SUPABASE_SECRET_KEY` : la clé ne transite pas et **aucune variable supplémentaire n’est à configurer**.
- La route relit les commandes modifiées depuis `orders_synced_through` (moins 10 minutes de chevauchement ; deux
  jours lors du premier passage), puis les importe par la même RPC que les webhooks : aucun doublon.
- La date de synchronisation n’avance jamais au-delà d’une commande en échec, et ne recule jamais. Chaque passage
  s’arrête après 7 secondes (limite des fonctions Netlify) et reprend au suivant.
- Dans Ventes > Commandes Shopify : bouton « Synchroniser maintenant », et synchronisation à l’ouverture de la page
  si la dernière date de plus de 15 minutes.
- Pourquoi pas une app d’une organisation Partenaire : le Client Credentials Grant ne fonctionne qu’au sein d’une
  même organisation, et depuis le 20 novembre 2026 une app personnalisée installée hors de son organisation exige
  une liste d’adresses IP autorisées, impossible avec les adresses dynamiques de Netlify.

Les webhooks de commande déclenchent la relecture de la commande par GraphQL (`src/lib/shopify/orders.ts`,
`order-sync.ts`), puis la RPC serveur `shopify_import_order` (migration `20261113120000_shopify_order_import.sql`).

- **Une commande = une vente** du canal `shopify`, identifiée par `shopify_order_imports(business_id, shopify_order_gid)` :
  une relivraison ou une relecture ne crée jamais de doublon.
- **Produits** : lien mémorisé de la variante, puis du produit (`shopify_product_links`), puis SKU identique et unique.
  Les produits non reconnus se relient une fois dans **Ventes > Commandes Shopify** ; les commandes concernées sont
  alors relancées automatiquement.
- **Validation automatique** quand tous les produits sont reliés, que lignes + port − remise = total, en euros et sans
  TVA : la vente est validée (snapshot des coûts) et l’encaissement enregistré avec les frais Shopify Payments.
  Sinon la vente reste en brouillon « à compléter ».
- **Ventes validées inaltérables** : une annulation ou un remboursement Shopify est seulement signalé ; l’utilisatrice
  enregistre le remboursement ou l’annulation, puis marque le signalement comme traité. Un brouillon annulé sur Shopify
  est supprimé.
- **Identité** : les RPC de vente existantes contrôlent `auth.uid()`. Pour un webhook, `shopify_import_order`
  (réservée à `service_role`) vérifie que l’acteur (la personne qui a connecté Shopify, à défaut la propriétaire) est
  membre de l’entreprise, puis fixe `request.jwt.claims` pour la transaction. Le journal d’audit porte
  `oauth_client_id = 'shopify-sync'`.
- **Données clientes** : seul le nom de facturation est lu, par une requête séparée tolérante au masquage des données
  protégées ; il n’est jamais stocké dans l’instantané de commande. Ni e-mail, ni téléphone, ni adresse.
- **Historique** : import des commandes payées (ou remboursées ensuite) depuis une date, 500 au plus par import.
  Sans la permission `read_all_orders`, Shopify limite l’accès aux 60 derniers jours.

La logique SQL a été exécutée de bout en bout dans PostgreSQL 18 (PGlite) avec toutes les migrations : commande
complète, idempotence, produit à relier puis validé, total incohérent, annulations, remboursement, commandes non payées,
de test ou en devise, TVA et contrôles d’accès.

Références : [Client Credentials Grant Shopify](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant), [vérification des webhooks Shopify](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [Supabase Vault](https://supabase.com/docs/guides/database/vault), [clés Supabase publishable et secret](https://supabase.com/docs/guides/getting-started/api-keys).
