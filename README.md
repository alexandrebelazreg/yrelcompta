# YrelCompta

YrelCompta est une application web française de gestion simplifiée pour une micro-entrepreneuse qui crée et vend des bijoux.

> La gestion simple de votre micro-entreprise de bijoux.

L’application fournit l’authentification, la création de l’entreprise et le suivi des ventes, encaissements, remboursements et déclarations enregistrées. Elle produit aussi une estimation interne de réserve fiscale et sociale à partir de règles légales versionnées ; cette estimation n’est ni une déclaration, ni un appel officiel de cotisations.

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

La migration initiale crée `profiles`, `businesses`, `business_members`, `business_settings` et `audit_logs`. La migration `20260805010000_sales_payments.sql` ajoute les ventes, lignes, encaissements et remboursements. La migration `20260805180000_expenses_documents.sql` ajoute les dépenses, fournisseurs, paiements, remboursements fournisseurs, justificatifs privés et modèles récurrents. La migration `20260807120000_registers_declarations.sql` prépare la date légale de début d’activité et l’historique immuable des déclarations. La migration `20260807220000_invoicing_documents.sql` prépare la facturation commerciale, les avoirs et leurs compteurs transactionnels. La migration `20260808120000_fiscal_social_rules.sql` ajoute les règles fiscales/sociales globales versionnées, les profils d’entreprise append-only et les snapshots d’estimation des nouvelles déclarations ; ces migrations doivent être relues avant toute application.

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

Une ligne peut être liée à un produit du catalogue ou rester en saisie libre. La sélection reprend le nom et le prix catalogue courants, mais la description et le prix réellement vendu restent modifiables dans le brouillon. Une évolution ultérieure du prix catalogue ne remplace jamais le prix saisi sur la vente.

Le coût produit n’est pas copié lors de la création du brouillon. Au moment exact de la validation définitive, la base recalcule atomiquement le coût courant (matières, pertes, main-d’œuvre et emballage), puis fige le nom, le SKU et chaque composante sur la ligne. Les changements ultérieurs du produit, de sa recette, des matières ou des paramètres de coût ne modifient donc jamais la vente validée.

Lorsque toutes les lignes sont liées à un produit, la marge historique est :

`sous-total marchandises - remise globale - coût de fabrication historique total`

La livraison est exclue, comme les commissions de paiement ou de plateforme, remboursements, cotisations, TVA et impôt. Une ligne libre reste autorisée et les éventuelles lignes produit de la même vente sont bien figées, mais la marge totale est alors déclarée indisponible. Les ventes validées avant l’ajout des snapshots restent sans coût historique : aucun coût courant approximatif n’est reconstitué a posteriori.

Tous les montants sont enregistrés sous forme d’entiers représentant des centimes d’euro. Le montant brut payé par la cliente alimente le chiffre d’affaires suivi. Une commission de plateforme est affichée séparément et ne réduit jamais ce montant brut :

- brut encaissé : somme payée par la cliente ;
- commission : frais Etsy, Stripe, SumUp ou autre ;
- net versé : brut moins commission ;
- remboursement : sortie liée à un encaissement précis.

Les tables métier sont en lecture seule via l’API Supabase. Toutes les écritures passent par des fonctions RPC `security definer` qui vérifient l’utilisateur, l’entreprise, le rôle et les invariants monétaires avant d’écrire dans le journal d’audit.

### Parcours manuel de test

1. Créez un produit et notez son coût de fabrication courant.
2. Créez un brouillon de vente lié à ce produit.
3. Modifiez le coût d’une matière avant validation.
4. Validez la vente et vérifiez que ce nouveau coût est figé.
5. Modifiez à nouveau le produit ou la matière et vérifiez que la vente validée ne change plus.
6. Créez une vente avec une ligne libre et vérifiez que la marge totale est déclarée indisponible.
7. Vérifiez qu’une remise réduit la marge et que la livraison ne la modifie pas.
8. Enregistrez un encaissement avec commission, puis un remboursement, et vérifiez qu’ils ne recalculent aucun snapshot.
9. Après remboursement intégral, annulez la vente et vérifiez que ses coûts historiques sont conservés.

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

## Produits et coûts de fabrication

Le module **Produits** distingue les matières achetées des bijoux fabriqués. Une matière décrit un lot de référence avec son coût TTC en centimes et sa quantité en milli-unités. Ainsi, 100 perles correspondent à `100000` milli-pièces, 25 grammes à `25000` milli-grammes et 2,5 mètres de chaîne à `250000` milli-centimètres. Aucun prix unitaire décimal n’est persisté.

Une recette associe une quantité de chaque matière au produit. Le coût rationnel de chaque consommation est `coût du lot × quantité consommée ÷ quantité du lot`. Ces fractions sont additionnées exactement, puis le total des matières est arrondi une seule fois au centime. Le coût de fabrication estimé ajoute ensuite les pertes configurées, la valorisation du temps de travail et l’emballage spécifique ou par défaut :

`matières arrondies + pertes arrondies + main-d’œuvre arrondie + emballage`

La marge affichée est le prix de vente diminué de ce coût de fabrication. Elle reste une **marge avant frais commerciaux, cotisations et fiscalité** : elle n’intègre ni commissions Stripe/Etsy/SumUp ou bancaires, ni URSSAF, TVA, impôt ou expédition. Cette estimation utilise les prix courants des matières et ne constitue pas un coût historique figé.

### Parcours manuel de test des produits

1. Ouvrez **Produits > Matières**, créez une matière avec un lot et vérifiez le coût unitaire indicatif.
2. Configurez la valorisation horaire et l’emballage par défaut dans **Paramètres de coût**.
3. Créez un produit, ajoutez plusieurs matières à sa recette et contrôlez la prévisualisation.
4. Vérifiez sur la fiche le détail matières, pertes, main-d’œuvre, emballage, coût total et marge.
5. Modifiez la recette, retirez une ligne et vérifiez que son remplacement est complet.
6. Archivez une matière déjà utilisée et vérifiez que la recette existante reste lisible.
7. Archivez un produit et vérifiez qu’il reste consultable dans le filtre **Archivés**.

## Tableau de bord mensuel et seuil de rentabilité

Le tableau de bord accepte `?mois=YYYY-MM` et utilise le mois courant en `Europe/Paris` lorsque le paramètre est absent ou invalide. Les périodes sont toujours traitées avec un début inclus et le début du mois suivant exclusif. Les dernières ventes et les justificatifs manquants restent des suivis globaux, indépendants du mois choisi.

Les indicateurs séparent volontairement quatre notions :

- le **chiffre d’affaires encaissé** est la somme des encaissements bruts datés du mois, diminuée des remboursements clients datés du mois ;
- le **flux net suivi** retranche ensuite les commissions des paiements reçus pendant le mois et les dépenses professionnelles nettes effectivement payées. C’est un suivi de trésorerie, pas un bénéfice comptable ou fiscal ;
- la **marge de fabrication historique** est calculée sur les ventes validées du mois qui disposent d’un snapshot complet : `sous-total marchandises - remise - coût de fabrication historique`. Elle exclut livraison, commissions, remboursements, cotisations, TVA et impôt ;
- les **charges fixes prévisionnelles** proviennent uniquement des modèles récurrents actifs, fixes et d’exploitation. Elles ne sont pas remplacées par les dépenses réellement payées du mois.

Les modèles de nature `investment` ou `tax_social`, de comportement `variable` ou `exceptional`, ainsi que les catégories `taxes_social`, `raw_materials` et `packaging`, sont exclus des charges fixes. Les matières et emballages sont déjà intégrés au coût de fabrication et ne doivent pas être comptés deux fois. Pour chaque modèle éligible, la part professionnelle est arrondie avec la même règle que dans le module Dépenses. Les montants sont ensuite annualisés (`mensuel × 12`, `trimestriel × 4`, `annuel × 1`), additionnés, puis divisés par 12 avec un seul arrondi final pour l’affichage mensuel.

Le taux de marge de référence est pondéré par le chiffre d’affaires marchandises des ventes validées avec snapshot complet sur les 90 jours se terminant au début du mois suivant. Ce n’est jamais une moyenne simple des taux par vente. Le seuil est ensuite calculé exactement en centimes :

`ceil(charges fixes annuelles × CA marchandises de référence / (12 × marge de fabrication de référence))`

Il représente le chiffre d’affaires marchandises nécessaire pour que la marge de fabrication couvre les charges fixes récurrentes estimées. Il ne constitue pas un résultat fiscal complet et exclut volontairement cotisations sociales, TVA, impôt et coûts commerciaux absents de la marge produit. La réserve fiscale/sociale est présentée dans une section distincte et ne modifie jamais ce seuil.

La **réserve fiscale et sociale estimée** utilise le chiffre d’affaires brut encaissé du mois lorsqu’il n’existe aucun remboursement client et que l’entreprise est en franchise de TVA. Elle additionne les cotisations micro-sociales, la CFP et, seulement si l’option du profil est active, le versement libératoire. Le **flux net suivi après réserve estimée** est le flux net suivi déjà calculé moins cette réserve : il ne s’agit ni d’un bénéfice net, ni du montant réellement appelé par l’Urssaf. En présence d’un remboursement, d’une TVA non ventilée, d’un profil absent, d’une règle légale indisponible ou d’une ACRE active, aucun montant partiel n’est affiché.

Une vente récente au coût incomplet ou une vente historique sans snapshot est comptée dans la couverture, mais jamais intégrée silencieusement à la marge. L’écart entre marge mensuelle et charges fixes n’est affiché que si toutes les ventes validées du mois ont un coût historique complet. De même, le seuil est **indisponible** sans charges fixes configurées, sans vente complète de référence, ou avec un revenu ou une marge de référence non positifs. « Indisponible » signifie que les données ne permettent pas le calcul ; `0 €` reste réservé à un résultat réellement calculé égal à zéro.

Toutes les agrégations susceptibles de dépasser la limite Supabase sont paginées par blocs de 1 000 lignes. Une erreur sur n’importe quelle page annule l’ensemble du chargement : aucun total partiel n’est présenté. Les sommes, annualisations et ratios monétaires utilisent `BigInt`, avec contrôle de la plage sûre avant conversion en `number` pour l’affichage.

### Parcours manuel de test du tableau de bord

1. Ouvrez `/tableau-de-bord?mois=2026-08`, changez le mois et vérifiez que le formulaire conserve une URL en lecture seule.
2. Enregistrez un encaissement avec commission, un remboursement client, un paiement fournisseur et un remboursement fournisseur à des dates connues ; contrôlez séparément chiffre d’affaires encaissé, commissions, dépenses professionnelles nettes et flux net suivi.
3. Validez une vente produit avec remise et livraison ; vérifiez que la remise réduit la marge tandis que la livraison en reste exclue.
4. Ajoutez une vente libre ou historique sans snapshot et vérifiez la couverture ainsi que l’indisponibilité de l’écart mensuel.
5. Configurez des modèles récurrents mensuel, trimestriel et annuel avec différentes parts professionnelles, puis vérifiez leur estimation annualisée depuis le lien **Gérer les charges fixes**.
6. Vérifiez qu’un modèle variable, exceptionnel, d’investissement, social, de matières ou d’emballage n’alimente pas les charges fixes.
7. Contrôlez le taux pondéré sur les 90 jours précédant la fin du mois et le seuil calculé. Retirez ensuite toutes les charges fixes ou utilisez une période sans vente complète pour vérifier la raison d’indisponibilité.
8. Vérifiez qu’un mois sans flux affiche des zéros calculés pour la trésorerie, alors qu’un calcul sans données requises affiche « Indisponible ».

## Registres et déclarations

Le **livre des recettes** présente une ligne par encaissement, dans l’ordre de la date de réception puis de l’enregistrement dans YrelCompta. Sa source est `payments.gross_amount_cents` joint à la vente immuable : la commission reste une information distincte et ne réduit jamais la recette. Les règlements en espèces sont identifiés et les totaux sont calculés par trimestre civil puis pour l’année. Les remboursements clients sont affichés dans un bloc séparé et ne deviennent jamais automatiquement des recettes négatives.

Le **registre des achats** présente une ligne par règlement fournisseur lié à une dépense validée ou annulée. Le montant réglementaire affiché vient de `expense_payments.amount_cents`. La part `business_amount_cents` est montrée séparément comme suivi interne YrelCompta, jamais comme déduction fiscale. Les avoirs et remboursements fournisseurs restent eux aussi séparés du montant brut du registre. Les informations modifiables d’un fournisseur ne sont pas utilisées dans l’export tant qu’aucun snapshot historique fournisseur n’existe.

Les sources des deux registres sont inaltérables : les encaissements, remboursements, paiements fournisseurs et remboursements fournisseurs ne peuvent être modifiés ou supprimés. Les informations et justificatifs réglementaires doivent être conservés pendant **10 ans**. Les exports CSV utilisent les mêmes filtres annuels et le même ordre que l’écran, parcourent toutes les pages Supabase et neutralisent les cellules textuelles pouvant être interprétées comme des formules Excel (`=`, `+`, `-` ou `@`). Ils n’exportent aucun chemin Storage, URL signée, secret ou identifiant Auth inutile.

### Calendrier déclaratif

Le calendrier repose exclusivement sur `business_settings.activity_started_on` et sur la périodicité configurée, qui doit correspondre à celle enregistrée auprès de l’Urssaf. Sans date de début d’activité, aucun calendrier n’est inventé.

- En périodicité mensuelle, la première période commence à la date de début et se termine à la fin des trois mois civils consécutifs suivant le mois de début. Les périodes suivantes sont des mois civils.
- En périodicité trimestrielle, la première période commence à la date de début et se termine à la fin du trimestre civil suivant le trimestre de début. Les périodes suivantes sont les trimestres civils normaux.
- L’échéance théorique est le dernier jour du mois suivant la fin de période. Aucun report lié aux jours fériés n’est calculé.

Une période sans encaissement possède une proposition valide de `0 €`. En franchise de TVA et sans remboursement client, le montant proposé est la somme exacte des encaissements bruts de la période. Commissions, dépenses, matières, emballage, charges fixes, cotisations et impôt ne sont jamais déduits. Si l’entreprise est assujettie à la TVA, YrelCompta ne disposant pas encore de la ventilation HT/TVA, aucune proposition automatique n’est produite. De même, la présence d’un remboursement client rend la proposition indisponible : son traitement déclaratif doit être vérifié et le remboursement n’est pas soustrait automatiquement.

Le **montant déclaré** reste celui saisi par l’utilisatrice. Lorsqu’il diffère de la proposition, ou lorsque la proposition est indisponible, un motif est obligatoire. Une première déclaration crée la révision 1. Une correction ne modifie jamais cette ligne : elle ajoute une nouvelle révision liée à la précédente, avec un motif obligatoire. Le cumul annuel déclaré utilise uniquement la dernière révision de chaque période, tout en conservant l’historique complet.

« Déclarée » signifie uniquement qu’une révision a été enregistrée dans YrelCompta. L’application n’envoie rien à l’Urssaf : la transmission réelle reste à effectuer sur le service officiel. Pour une nouvelle révision disposant d’un profil et de règles applicables sur toute sa période, le montant déclaré sert à figer une estimation interne des cotisations, de la CFP et du versement libératoire éventuel. Une période traversant une nouvelle règle ou configuration reste non évaluée afin de ne jamais appliquer le taux du dernier jour à tout son chiffre d’affaires. Une ancienne déclaration non évaluée n’est jamais recalculée avec les taux courants. YrelCompta ne calcule ni TVA, ni impôt au barème progressif, ni pénalité, ni case de déclaration annuelle et ne constitue pas un logiciel comptable certifié.

### Parcours manuel de test des registres et déclarations

1. Renseignez une date de début d’activité et vérifiez la première période spéciale ainsi que l’échéance théorique.
2. Ouvrez les registres d’une année contenant plus d’un trimestre et contrôlez les ordres, totaux trimestriels et annuels.
3. Vérifiez qu’une commission ne réduit pas la recette et que les espèces sont identifiées.
4. Vérifiez que la part professionnelle d’un achat reste distincte du paiement brut et qu’une dépense annulée conserve son paiement historique.
5. Exportez les deux CSV et contrôlez leur ordre, leur encodage UTF-8 et les noms de fichiers déterministes.
6. Sur une période sans encaissement, enregistrez une déclaration à `0 €` et vérifiez la révision 1.
7. Testez une période avec remboursement client puis une entreprise assujettie à la TVA : la proposition doit être indisponible avec le message approprié.
8. Enregistrez une correction motivée et vérifiez que la révision précédente reste consultable et inchangée.
9. Vérifiez que la date de début d’activité ne peut plus être corrigée après l’enregistrement d’une déclaration.

## Facturation et documents clients

Une **vente** décrit l’opération commerciale, une **facture** fige le document adressé au client, un **paiement** décrit l’encaissement, un **remboursement** décrit le mouvement financier inverse et un **avoir** corrige monétairement une facture. Ces objets restent distincts : émettre une facture ne crée aucun paiement et émettre un avoir ne crée aucun remboursement.

Une facture est générée uniquement depuis une vente validée. Son émission relit en base les lignes, la livraison, la remise, les totaux, le régime TVA et les paramètres de facturation. Identité vendeur, données client, mention de franchise, conditions B2B et montants deviennent des snapshots immuables. Le PDF est ensuite régénéré exclusivement depuis ces snapshots : modifier les paramètres courants ne change jamais une ancienne facture.

La numérotation repose sur des lignes compteurs transactionnelles verrouillées dans la même transaction que le document. Les factures utilisent `FAC-YYYY-000001` et les avoirs une série indépendante `AV-YYYY-000001`, par entreprise et par année. Aucune `SEQUENCE` PostgreSQL ou `nextval` n’est utilisée : un rollback annule aussi l’incrément. Factures, avoirs et lignes ne peuvent être modifiés ni supprimés et doivent pouvoir être conservés pendant **10 ans**.

Cette V1 émet uniquement pour une entreprise configurée en **franchise de TVA**. Elle pose `vat_cents = 0`, conserve HT = TTC dans ce modèle et snapshote la mention configurée, proposée initialement comme « TVA non applicable, art. 293 B du CGI ». Si le régime est `liable`, l’émission est bloquée : aucun taux n’est codé en dur et YrelCompta ne tente jamais de reconstituer la TVA.

La facturation professionnelle V1 couvre les clients professionnels français et exige leur SIREN à 9 chiffres. La facturation internationale n’est pas encore modélisée ; cette version n’ajoute donc aucune règle de TVA internationale.

Une correction passe par un nouvel avoir immuable qui référence la facture initiale. Plusieurs avoirs partiels sont possibles sans dépasser le total facturé. Un avoir peut être relié à un remboursement de la même vente et du même montant, sans créer ni modifier ce remboursement. Une vente facturée ne peut être annulée qu’après crédit intégral et lorsque les règles historiques d’encaissement net nul sont également satisfaites.

Les PDF sont produits à la demande côté serveur avec PDFKit et une police Noto Sans embarquée, sans navigateur headless ni Storage. Ils gèrent les documents multipages, rappellent type, numéro et pagination sur chaque page, et n’intègrent aucune donnée dynamique de paiement, coût de fabrication, marge ou commission.

Le PDF généré par YrelCompta est un document commercial ; il n’est pas, à lui seul, une facture électronique au sens de la réforme française. La réception électronique devient une obligation générale à compter du **1er septembre 2026**. L’émission électronique et le e-reporting pour les micro-entreprises et PME sont prévus au **1er septembre 2027**. Cette version n’intègre aucune plateforme agréée, PDP, transmission B2B réglementaire, e-reporting ou envoi par e-mail.

### Parcours manuel de test de la facturation

1. Configurez l’identité EI, le SIRET, l’adresse, la mention de franchise et les quatre textes B2B dans `/parametres/facturation`.
2. Depuis une vente validée, ouvrez **Créer une facture**, vérifiez les sources affichées et confirmez le type d’opération ainsi que les données client.
3. Téléchargez le PDF, contrôlez les accents, le numéro, les snapshots vendeur/client, la mention TVA et les conditions applicables.
4. Émettez un avoir partiel puis un second avoir ; vérifiez que le total ne peut dépasser la facture initiale.
5. Reliez un remboursement du même montant à un avoir et contrôlez que les deux opérations restent présentées séparément.
6. Vérifiez les factures et avoirs dans `/documents`, sans URL Storage signée.
7. Utilisez une longue vente pour contrôler les en-têtes, pieds de page et numéros de pages du PDF multipage.

## Paramètres fiscaux et sociaux versionnés

La V1 couvre uniquement une micro-entreprise en France métropolitaine relevant du micro-BIC pour la vente de marchandises ou d’objets, adaptée à l’activité de bijoux YrelCompta. Les taux, fractions ACRE, plafonds micro et seuils de franchise de TVA sont stockés dans des tables globales immuables. Une nouvelle évolution légale ajoute une version datée par migration ; elle ne remplace jamais une ancienne ligne. Pour chaque date, YrelCompta résout la dernière version entrée en vigueur.

Les choix propres à l’entreprise sont séparés de ces règles. Chaque version du profil indique la catégorie CFP commerciale ou artisanale, l’ACRE déclarée et l’option de versement libératoire. La première version prend effet à la date légale de début d’activité. Les suivantes sont ajoutées sans modification de l’historique, au 1er janvier, et ne peuvent pas réécrire une période déjà enregistrée. L’ancien champ ACRE des paramètres initiaux n’est qu’une aide au préremplissage de la première version ; le profil versionné devient ensuite la source des estimations.

Les notions restent volontairement distinctes :

- le **CA encaissé** est constitué des encaissements bruts réellement datés ;
- le **CA déclaré** est le montant que l’utilisatrice indique avoir effectivement déclaré, sans transmission par YrelCompta ;
- la **réserve estimée** est une prévision interne de trésorerie calculée par arithmétique entière à partir du CA et des versions applicables ;
- la **cotisation réellement appelée** reste le montant communiqué par l’Urssaf et peut différer de l’estimation ;
- le **versement libératoire** est ajouté uniquement lorsque l’option est activée dans le profil ; sans cette option, aucun impôt sur le revenu n’est estimé ;
- la **TVA** n’est ni ventilée ni calculée par cette version ;
- la **marge de fabrication** et le **flux net suivi** sont des indicateurs distincts, qui ne constituent pas un bénéfice fiscal.

Les paramètres affichent le taux ACRE **théorique** et sa date de fin à titre de référence. La réserve monétaire reste toutefois indisponible pendant toute période ACRE active : le plafond légal d’exonération, sa proratisation éventuelle, le chiffre d’affaires cumulé qui le consomme et le franchissement en cours de période ne sont pas encore modélisés. YrelCompta refuse donc de sous-estimer les cotisations en appliquant 6,20 % ou 9,30 % à tout le chiffre d’affaires. Après la fin de l’ACRE, le taux social normal redevient calculable. La CFP et le versement libératoire ne sont jamais réduits.

Chaque nouvelle déclaration ou correction fige ses identifiants de versions, taux et montants uniquement lorsqu’une estimation complète est possible. Pendant l’ACRE, lorsqu’une période traverse une frontière de règle/configuration, ou lorsqu’un profil/règle manque, elle reste enregistrable mais conserve un statut d’indisponibilité et des snapshots monétaires entièrement nuls. Les enregistrements antérieurs à cette fonctionnalité restent explicitement « non évalués historiquement ».

Cette V1 exclut les prestations de services, le BNC, la Cipav, les DROM, l’international, la CFE, l’impôt au barème progressif, la proratisation avancée des seuils, le calcul ou la déclaration de TVA, les alertes automatiques de dépassement et tout changement automatique de régime. Aucun paiement ni aucune déclaration n’est transmis à l’Urssaf ou aux impôts.

### Parcours manuel de test fiscal et social

1. Renseignez la date de début d’activité puis ouvrez `/parametres/fiscalite` et créez la première version à cette date.
2. Vérifiez les taux et seuils légaux en lecture seule, puis les deux catégories de CFP, l’ACRE et le versement libératoire.
3. Ouvrez un mois sans remboursement sur le tableau de bord et contrôlez la réserve ainsi que le flux suivi après réserve.
4. Ajoutez un remboursement client, puis testez un régime TVA `liable` : aucun montant fiscal partiel ne doit être présenté.
5. Enregistrez une déclaration puis une correction ; contrôlez que chacune conserve son propre snapshot et que l’ancienne révision reste inchangée.
6. Créez une version future au 1er janvier et vérifiez l’historique. Une date rétroactive touchant une déclaration existante doit être refusée.

## Limites de cette version

Le module ne propose ni OCR, rapprochement ou connexion bancaire, stock, lots d’achat, valorisation FIFO/CUMP, décrémentation à la vente, amortissements, TVA récupérable, calcul officiel URSSAF, images ou variantes produit, génération planifiée des récurrences ou comptabilité certifiée. Il ne transmet aucune déclaration. Les registres, indicateurs, estimations et calendriers sont uniquement des outils de préparation et de suivi ; aucun taux de TVA n’est calculé.

Les futures écritures comptables validées devront être rendues inaltérables par une conception dédiée ; `audit_logs` ne constitue pas encore ce registre.
