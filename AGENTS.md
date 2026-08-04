# Consignes pour les futures tâches Codex

- L’interface et la documentation de YrelCompta sont en français.
- Le produit concerne la micro-entreprise française d’une créatrice et vendeuse de bijoux.
- Les données personnelles, commerciales et comptables sont sensibles.
- RLS est obligatoire sur toute table accessible depuis l’application.
- Une clé Supabase `service_role` ne doit jamais être exposée au navigateur ni ajoutée aux variables publiques.
- Toute fonction métier doit isoler les données par `business_id` et vérifier l’appartenance côté base.
- Les opérations comptables validées seront ultérieurement conçues pour être inaltérables.
- Aucun taux fiscal, social ou de TVA ne doit être codé en dur sans mécanisme de configuration versionné.
- Les modifications doivent rester petites, testées et documentées.
- Les Server Components sont le choix par défaut ; n’utiliser un Client Component que pour une interaction nécessaire.
- Avant livraison, exécuter lint, typecheck, tests et build de production.
