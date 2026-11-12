# Connecteur Claude (MCP)

YrelCompta expose un serveur MCP distant que l’utilisatrice ajoute dans Claude comme connecteur personnalisé.
Claude agit **avec le compte de l’utilisatrice** : il reçoit un jeton OAuth délivré par Supabase Auth, et toutes
les requêtes passent par RLS et les RPC existantes. Aucune clé `service_role` n’est utilisée.

## Outils

| Lecture | Écriture (accord demandé par Claude) |
| --- | --- |
| `list_material_categories`, `list_materials`, `list_products`, `list_suppliers`, `list_recurring_charges`, `get_profitability` | `create_supplier`, `create_material`, `update_material`, `create_product`, `create_recurring_charge`, `create_expense_draft` |

Règles des écritures :
- elles passent uniquement par les RPC déjà utilisées par l’application, après la **même validation Zod** que les formulaires ;
- les dépenses sont créées **en brouillon** : l’utilisatrice les vérifie, joint le justificatif et les valide dans l’app ;
- aucune validation, aucun paiement, remboursement, archivage forcé ni suppression ; pas d’accès aux ventes, factures,
  encaissements ni justificatifs ;
- garde-fous contre les doublons : fournisseur de même nom réutilisé, matière ou produit existant refusé, dépense
  identique (date, montant, description) refusée sans confirmation explicite (`allow_duplicate`) ;
- chaque écriture est tracée : la colonne `audit_logs.oauth_client_id` reçoit le `client_id` du jeton (migration
  `20261112120000_audit_oauth_client.sql`, sans changement de RPC).

## Architecture

| Élément | Rôle |
| --- | --- |
| `POST /api/mcp` | Transport « Streamable HTTP » sans état, réponses JSON. Exige `Authorization: Bearer <jeton OAuth>`. |
| `/.well-known/oauth-protected-resource[/api/mcp]` | Métadonnées RFC 9728 : désignent `https://<projet>.supabase.co/auth/v1` comme serveur d’autorisation. |
| `/oauth/consent` | Page de consentement appelée par Supabase Auth (`authorization_id`). Affiche l’application et le domaine de retour. |
| `/parametres/claude` | Instructions de connexion, applications connectées et retrait d’accès. |

Un jeton n’est accepté que s’il porte la revendication `client_id` (jeton émis pour une application tierce, et non
une session du site). Les outils s’exécutent dans `runWithSupabaseClient`, si bien que les requêtes métier
existantes (`listMaterials`, `getProfitabilityData`…) utilisent le jeton de l’utilisatrice.

## Activation (une seule fois, dans le tableau de bord Supabase)

1. **Authentication → OAuth Server** : activer « OAuth 2.1 server capabilities » (fonction en bêta, sans surcoût).
2. Sur la même page, **Authorization Path** : `/oauth/consent`.
3. Autoriser l’**enregistrement dynamique des clients** (Dynamic Client Registration), utilisé par Claude.
   Toute application peut alors s’enregistrer, mais aucune n’obtient d’accès sans la connexion de l’utilisatrice
   et son accord explicite sur la page de consentement, qui signale tout domaine de retour autre que Claude.
4. **Authentication → URL Configuration** : la *Site URL* doit être l’adresse de production (Netlify), car la page de
   consentement est construite à partir d’elle.
5. Vérifier : `https://<projet>.supabase.co/.well-known/oauth-authorization-server/auth/v1` doit renvoyer du JSON
   (et non `feature_disabled`).

La migration `20261112120000_audit_oauth_client.sql` (traçabilité) peut être appliquée avant ou après le déploiement.

## Connexion côté Claude

Paramètres → Connecteurs → Ajouter un connecteur personnalisé, adresse `https://<site>/api/mcp`, client OAuth en
enregistrement automatique, puis connexion avec le compte YrelCompta et « Autoriser ».
L’accès se retire depuis `/parametres/claude` (ou depuis Claude).

## Limites connues

- Les jetons Supabase ont l’audience `authenticated` : ils ne sont pas liés à la ressource (RFC 8707).
  L’exigence de `client_id` limite leur usage aux applications OAuth.
- Les montants sont renvoyés formatés en euros ; Claude les envoie en euros TTC (« 12,50 »), convertis en centimes.
- Une autorisation déjà accordée couvre automatiquement les nouveaux outils : l’utilisatrice est prévenue par la page
  Paramètres → Claude.
