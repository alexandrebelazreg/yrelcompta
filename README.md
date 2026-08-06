# YrelCompta

YrelCompta est une application web française de gestion simplifiée pour une micro-entrepreneuse qui crée et vend des bijoux.

> La gestion simple de votre micro-entreprise de bijoux.

L’application fournit l’authentification, la création de l’entreprise et une première version du suivi des ventes, encaissements et remboursements. Elle ne réalise aucun calcul fiscal ou social.

## Stack technique

- Next.js 16 avec App Router et Server Components par défaut ;
- React 19 et TypeScript strict ;
- Tailwind CSS 4 et composants internes accessibles ;
- Supabase PostgreSQL, Auth, `@supabase/supabase-js` et `@supabase/ssr` ;
- Zod pour la validation partagée ;
- Vitest pour les tests unitaires ;
- déploiement prévu sur Netlify avec son support Next.js automatique.

Node.js 24 LTS est épinglé dans `.nvmrc` et `package.json`.

## Prérequis

- Node.js 24 et npm ;
- un compte Supabase ;
- facultativement, Supabase CLI pour appliquer les migrations depuis le terminal.

## Installation locale

```bash
git clone https://github.com/alexandrebelazreg/yrelcompta.git
cd yrelcompta
nvm use
npm install
cp .env.example .env.local
```

Sous Windows, copiez manuellement `.env.example` vers `.env.local` si `cp` n’est pas disponible. Ne commitez jamais `.env.local`.

## Créer et configurer le projet Supabase

1. Créez un projet sur [Supabase](https://supabase.com/dashboard).
2. Ouvrez **SQL Editor**, copiez le contenu de `supabase/migrations/20260804230000_bootstrap_yrelcompta.sql`, puis exécutez-le.
3. Dans **Authentication > URL Configuration**, définissez l’URL du site et ajoutez les URL de redirection :
   - `http://localhost:3000/auth/callback` en local ;
   - `https://VOTRE-SITE.netlify.app/auth/callback` en production.
4. Dans **Authentication > Providers > Email**, conservez l’authentification e-mail/mot de passe. La confirmation d’e-mail est prise en charge ; elle est recommandée en production.

Avec Supabase CLI, après avoir lié le projet :

```bash
supabase link --project-ref VOTRE_REFERENCE
supabase db push
```

La migration initiale crée `profiles`, `businesses`, `business_members`, `business_settings` et `audit_logs`. La migration `20260805010000_sales_payments.sql` ajoute les ventes, lignes, encaissements et remboursements. La migration `20260805180000_expenses_documents.sql` ajoute les dépenses, fournisseurs, paiements, remboursements fournisseurs, justificatifs privés et modèles récurrents.

Avant d’appliquer une nouvelle migration sur un projet lié, inspectez toujours le plan :

```bash
npx supabase db push --dry-run
npx supabase db push
```

Le `--dry-run` doit toujours être relu avant l’application future. Cette commande ne doit jamais être lancée automatiquement par l’application ou par une tâche de développement.

## Variables d’environnement

Créez `.env.local` à partir de `.env.example` :

```env
NEXT_PUBLIC_SUPABASE_URL=https://VOTRE_REFERENCE.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Supabase recommande désormais le nom **Publishable key**. Il remplace progressivement l’ancienne clé publique `anon` ; le tableau de bord fournit la bonne valeur. Cette clé est conçue pour être publique, contrairement à une clé `service_role`, qui ne doit jamais entrer dans cette application.

L’application se compile sans ces valeurs et affiche un message de configuration clair. L’authentification devient fonctionnelle dès qu’elles sont renseignées.

## Lancement et scripts

```bash
npm run dev          # serveur local http://localhost:3000
npm run build        # build de production
npm run start        # exécuter le build
npm run lint         # ESLint
npm run typecheck    # TypeScript strict
npm run test         # Vitest en mode interactif
npm run test:run     # tests en une passe
```

## Créer un utilisateur

1. Lancez l’application et ouvrez `/inscription`.
2. Saisissez un e-mail et un mot de passe de huit caractères minimum.
3. Si la confirmation est active, cliquez sur le lien reçu par e-mail.
4. Connectez-vous puis complétez `/demarrage`.
5. Le RPC crée dans une même transaction le profil, l’entreprise, le rôle `owner`, les paramètres initiaux et une trace d’audit.

## Déploiement Netlify

Netlify détecte automatiquement Next.js et utilise son support moderne ; aucun `netlify.toml` n’est nécessaire.

1. Importez le dépôt GitHub dans Netlify.
2. Laissez la commande de build détectée (`npm run build`) et le répertoire de publication automatique.
3. Choisissez Node 24 si Netlify ne lit pas automatiquement `engines`.
4. Ajoutez dans **Site configuration > Environment variables** :
   - `NEXT_PUBLIC_SUPABASE_URL` ;
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ;
   - `NEXT_PUBLIC_SITE_URL` avec l’URL HTTPS publique Netlify, sans barre finale.
5. Ajoutez l’URL de callback Netlify aux URL autorisées dans Supabase, puis redéployez.

N’ajoutez aucune clé Supabase privée ou `service_role` dans Netlify pour cette version.

## Sécurité

- Toutes les tables accessibles par l’application ont RLS activé.
- Les requêtes serveur vérifient l’utilisateur auprès de Supabase Auth ; une session cliente seule ne protège jamais les données.
- Le proxy Next.js rafraîchit les cookies Supabase. Aucun jeton n’est enregistré manuellement dans `localStorage`.
- Les fonctions `is_business_member` et `is_business_owner` évitent les politiques récursives. Elles ont un `search_path` vide et des droits minimaux.
- L’onboarding est atomique et génère l’entreprise côté base. Il ne fait pas confiance à un identifiant d’entreprise envoyé par le navigateur.
- Un membre ne voit que les données de ses entreprises ; seul un propriétaire peut modifier l’entreprise et ses paramètres.
- `.gitignore` exclut tous les fichiers `.env` sauf le modèle vide `.env.example`.

## Ventes et encaissements

Le module permet de créer et modifier une vente en brouillon, puis de la valider définitivement. Une vente validée conserve ses lignes, montants, date et canal. Les encaissements et remboursements sont également immuables : une erreur d’encaissement est corrigée par un remboursement de type `correction`.

Tous les montants sont enregistrés sous forme d’entiers représentant des centimes d’euro. Le montant brut payé par la cliente alimente le chiffre d’affaires suivi. Une commission de plateforme est affichée séparément et ne réduit jamais ce montant brut :

- brut encaissé : somme payée par la cliente ;
- commission : frais Etsy, Stripe, SumUp ou autre ;
- net versé : brut moins commission ;
- remboursement : sortie liée à un encaissement précis.

Les tables métier sont en lecture seule via l’API Supabase. Toutes les écritures passent par des fonctions RPC `security definer` qui vérifient l’utilisateur, l’entreprise, le rôle et les invariants monétaires avant d’écrire dans le journal d’audit.

### Parcours manuel de test

1. Connectez-vous avec un propriétaire ou un membre de l’entreprise.
2. Ouvrez **Ventes**, créez un brouillon avec plusieurs lignes et vérifiez le total affiché.
3. Modifiez le brouillon, puis validez-le.
4. Vérifiez que ses lignes et montants ne sont plus modifiables.
5. Enregistrez un encaissement partiel avec une commission et contrôlez les montants brut et net.
6. Complétez l’encaissement, puis enregistrez un remboursement partiel ou total.
7. Vérifiez que le remboursement n’augmente pas le reste à encaisser.
8. Après remboursement intégral, annulez la vente avec un motif.
9. Vérifiez le chiffre d’affaires encaissé du mois sur le tableau de bord.

## Dépenses et justificatifs

Une dépense décrit la facture ou l’achat fournisseur. Elle est distincte de son paiement réel et d’un éventuel remboursement :

- un brouillon reste modifiable et n’alimente aucun reste global à payer ;
- une dépense validée est figée et peut recevoir plusieurs paiements et justificatifs ;
- un paiement ou remboursement fournisseur est définitif et ne peut être modifié ni supprimé ;
- un remboursement réduit les dépenses nettes du mois où il est reçu, sans recréer de reste à payer ;
- une annulation contrôlée reste possible uniquement lorsque le paiement net est nul.

La « Part professionnelle pour le suivi interne » répartit les montants avec une précision de 0,01 %, sans constituer un conseil ou calcul fiscal. Les catégories couvrent notamment matières premières, emballages, expédition, logiciels, marketing, équipement, assurances, frais bancaires, services professionnels, déplacements, bureau et formation. Les commissions déjà suivies sur un encaissement de vente ne sont jamais recréées automatiquement comme dépenses.

Les justificatifs sont enregistrés dans le bucket privé `expense-documents` (PDF ou images autorisées, 10 Mo maximum). L’application génère uniquement des URL signées d’une minute ; aucun fichier n’a d’URL publique permanente. L’ajout se fait depuis une dépense. Un justificatif de dépense validée ne peut plus être retiré.

Les charges récurrentes sont uniquement des modèles manuels. Elles ne sont pas comptabilisées avant la création explicite d’un brouillon et aucune tâche planifiée ne les génère automatiquement.

### Parcours manuel de test des dépenses

1. Créez un fournisseur puis une dépense en brouillon avec une part professionnelle de 50 %.
2. Modifiez le brouillon, joignez puis retirez un justificatif privé.
3. Validez la dépense et vérifiez que ses informations sont figées.
4. Ajoutez un justificatif après validation et vérifiez qu’il ne peut plus être retiré.
5. Enregistrez un paiement partiel puis un remboursement fournisseur lié à ce paiement.
6. Vérifiez que le remboursement ne modifie pas le reste à payer.
7. Créez un modèle récurrent puis générez manuellement un brouillon.
8. Contrôlez les dépenses nettes payées et les justificatifs manquants sur le tableau de bord.
9. Ouvrez **Documents** et vérifiez que l’aperçu utilise une URL temporaire.

## Limites de cette version

Le module ne propose ni OCR, rapprochement ou connexion bancaire, calcul de coût de revient, stock, amortissements, TVA récupérable, calcul URSSAF, génération planifiée des récurrences ou comptabilité certifiée. Il ne transmet aucune déclaration. Les indicateurs sont uniquement des outils de suivi et aucun taux fiscal, social ou de TVA n’est calculé.

Les futures écritures comptables validées devront être rendues inaltérables par une conception dédiée ; `audit_logs` ne constitue pas encore ce registre.
