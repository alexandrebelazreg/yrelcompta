# Connecteur Claude (MCP)

YrelCompta expose un serveur MCP distant que l’utilisatrice ajoute dans Claude comme connecteur personnalisé.
Claude agit **avec le compte de l’utilisatrice** : il reçoit un jeton OAuth délivré par Supabase Auth, et toutes
les requêtes passent par RLS et les RPC existantes. Aucune clé `service_role` n’est utilisée.

## Outils

| Type | Outils |
| --- | --- |
| Lecture | `list_material_categories`, `list_materials`, `list_products`, `list_suppliers`, `list_recurring_charges`, `get_profitability`, `list_sales`, `get_sale`, `get_sales_summary`, `list_invoices`, `get_invoice`, `list_expenses`, `get_expense`, `get_costing_settings` |
| Écriture (accord demandé par Claude) | `create_supplier`, `update_supplier`, `create_material`, `update_material`, `update_material_category`, `create_product`, `update_product`, `create_recurring_charge`, `update_recurring_charge`, `generate_expense_from_recurring_charge`, `create_expense_draft`, `update_expense_draft`, `create_sale_draft`, `update_sale_draft`, `update_costing_settings` |
| Définitif (accord + `confirmation: true`) | `validate_sale`, `record_sale_payment`, `record_sale_refund`, `cancel_sale`, `delete_sale_draft`, `issue_invoice`, `issue_credit_note`, `validate_expense`, `record_expense_payment`, `record_expense_refund`, `cancel_expense`, `delete_expense_draft`, `archive_supplier`, `archive_recurring_charge`, `archive_product`, `archive_material` |

Règles :
- toute écriture passe par les RPC déjà utilisées par l’application, après la **même validation Zod** que les formulaires
  (schémas de facturation déplacés dans `src/lib/invoicing/validation.ts` pour être partagés) ;
- les actions définitives sont annotées `destructiveHint` et exigent le champ `confirmation: true`, que Claude ne doit
  renseigner qu’après une confirmation explicite de l’utilisatrice pour cette action précise ;
- une vente, une dépense ou une facture validée reste inaltérable : la correction passe par un remboursement, un avoir
  ou une annulation tracés, conformément aux règles du projet ;
- hors de portée : paramètres légaux de facturation, profil fiscal, justificatifs (fichiers) et connexion Shopify ;
- les acheteurs ne sont **lus** que par leur nom ; leurs coordonnées ne sont transmises que lorsque l’utilisatrice les
  fournit pour émettre une facture ;
- garde-fous contre les doublons à la création (fournisseur réutilisé, matière ou produit existant refusé, dépense
  identique refusée sans `allow_duplicate`) ;
- chaque écriture est tracée : `audit_logs.oauth_client_id` reçoit le `client_id` du jeton.

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
