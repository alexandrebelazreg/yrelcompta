# Consignes pour les futures tâches Codex

- L’interface et la documentation de YrelCompta sont en français.
- Le produit concerne la micro-entreprise française d’une créatrice et vendeuse de bijoux.
- Les données personnelles, commerciales et comptables sont sensibles.
- RLS est obligatoire sur toute table accessible depuis l’application.
- Une clé Supabase `service_role` ne doit jamais être exposée au navigateur ni ajoutée aux variables publiques.
- Toute fonction métier doit isoler les données par `business_id` et vérifier l’appartenance côté base.
- Les montants monétaires persistés sont des entiers en centimes d’euro, jamais des nombres décimaux.
- Les écritures métier sensibles passent par des RPC `security definer` contrôlés ; les tables restent en lecture seule via RLS pour les rôles applicatifs.
- Les ventes validées, encaissements et remboursements sont inaltérables ; une correction financière passe par un remboursement tracé.
- Les dépenses validées, paiements et remboursements fournisseurs sont inaltérables ; une correction financière est toujours tracée.
- Les justificatifs sont privés : aucun lien Storage public ou permanent ne doit être produit.
- Les commissions du module Ventes ne sont jamais dupliquées automatiquement comme dépenses.
- La part professionnelle sert au suivi interne et ne doit jamais être présentée comme une déduction fiscale.
- Les opérations comptables validées seront ultérieurement conçues pour être inaltérables.
- Aucun taux fiscal, social ou de TVA ne doit être codé en dur sans mécanisme de configuration versionné.
- Les modifications doivent rester petites, testées et documentées.
- Les Server Components sont le choix par défaut ; n’utiliser un Client Component que pour une interaction nécessaire.
- Avant livraison, exécuter lint, typecheck, tests et build de production.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
