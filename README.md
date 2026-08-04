# YrelCompta

YrelCompta est une application web française de gestion simplifiée pour une micro-entrepreneuse qui crée et vend des bijoux.

> La gestion simple de votre micro-entreprise de bijoux.

Cette première version fournit le socle : authentification, création de l’entreprise, isolation des données, navigation et tableau de bord vide. Elle ne réalise encore aucun calcul comptable.

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

La migration crée `profiles`, `businesses`, `business_members`, `business_settings` et `audit_logs`, ainsi que les types, index, triggers, politiques RLS et le RPC atomique `complete_onboarding`.

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

## Limites de cette version

Les pages Ventes, Dépenses, Produits, Documents, Registres et Paramètres sont des écrans d’attente protégés. Il n’existe encore ni tables métier correspondantes, ni factures, ni stocks, ni déclarations, ni taux fiscaux ou sociaux, ni calcul comptable. Les montants du tableau de bord sont volontairement des états vides à `0,00 €`.

Les futures écritures comptables validées devront être rendues inaltérables par une conception dédiée ; `audit_logs` ne constitue pas encore ce registre.
