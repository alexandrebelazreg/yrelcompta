import { SHOPIFY_REQUIRED_SCOPES } from "@/lib/shopify/constants";

const DEV_DASHBOARD_URL = "https://dev.shopify.com/dashboard/";
const DEFAULT_APP_URL = "https://shopify.dev/apps/default-app-home";

/** Libellés Shopify (en anglais dans l’interface Shopify) et leur sens en français. */
function UiLabel({ en, fr }: { en: string; fr?: string }) {
  return <><strong>{en}</strong>{fr && <span className="shopify-guide-translation"> ({fr})</span>}</>;
}

const troubleshooting: Array<{ problem: string; solution: string }> = [
  { problem: "« Cette boutique ou cette app n’appartient pas à la même organisation Shopify »", solution: "L’app doit être créée dans le Dev Dashboard de l’organisation qui possède la boutique. Vérifiez que la boutique apparaît bien dans cette organisation, puis réinstallez l’app (étape 3)." },
  { problem: "« La boutique Shopify est introuvable ou l’app n’y est pas installée »", solution: "L’app n’est pas installée sur cette boutique, ou le domaine saisi n’est pas le bon. Refaites l’étape 3 et vérifiez l’adresse en .myshopify.com." },
  { problem: "« Les identifiants Shopify ont été refusés »", solution: "Le Client ID ou le Client Secret est incorrect. Recopiez-les depuis Settings → Credentials, sans espace avant ni après." },
  { problem: "« La permission Shopify read_orders (ou read_products) est manquante »", solution: "Ajoutez les deux permissions dans une nouvelle version de l’app (étape 2), publiez-la avec Release, puis acceptez les nouvelles permissions dans l’administration Shopify de la boutique." },
  { problem: "« Seules les boutiques Shopify en EUR sont prises en charge »", solution: "La devise de la boutique doit être l’euro (Paramètres Shopify → Paramètres généraux → Devise de la boutique)." },
  { problem: "« Notifications instantanées : 0/5 » ou « synchronisation par l’API »", solution: "Shopify refuse les notifications instantanées à certaines boutiques, notamment sur l’offre Basic (pas d’accès aux données clientes protégées). Ce n’est pas bloquant : YrelCompta récupère vos commandes automatiquement toutes les 15 minutes, et vous pouvez cliquer sur « Synchroniser maintenant » dans Ventes → Commandes Shopify." },
  { problem: "« Cette boutique Shopify est déjà reliée à une autre entreprise YrelCompta »", solution: "Une boutique ne peut être reliée qu’à une seule entreprise. Déconnectez-la d’abord de l’autre compte." },
];

/** Mode d’emploi complet de la connexion Shopify, ouvert tant que la boutique n’est pas connectée. */
export function ShopifyGuide({ open }: { open: boolean }) {
  return <section className="card form-stack shopify-guide" aria-labelledby="shopify-guide-heading">
    <details open={open}>
      <summary><h2 id="shopify-guide-heading">Comment connecter votre boutique Shopify</h2><span className="shopify-guide-duration">Environ 10 minutes</span></summary>

      <div className="shopify-guide-body">
        <div className="shopify-guide-block">
          <h3>Avant de commencer</h3>
          <ul>
            <li>Une boutique Shopify dont la devise est l’<strong>euro</strong>.</li>
            <li>Un accès au <strong>Dev Dashboard</strong> de Shopify : propriétaire de la boutique, ou compte avec le rôle <UiLabel en="App developer" fr="développeur d’applications"/>.</li>
            <li>L’app et la boutique doivent appartenir à la <strong>même organisation Shopify</strong>.</li>
          </ul>
          <p className="shopify-guide-note">L’interface Shopify est souvent en anglais : les noms des boutons sont indiqués tels qu’ils apparaissent, avec leur traduction.</p>
        </div>

        <ol className="shopify-guide-steps">
          <li>
            <h3>Créer l’app YrelCompta dans Shopify</h3>
            <ol>
              <li>Ouvrez le <a href={DEV_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">Dev Dashboard de Shopify</a> et connectez-vous avec votre compte Shopify.</li>
              <li>Dans le menu de gauche, choisissez <UiLabel en="Apps" fr="applications"/>, puis <UiLabel en="Create app" fr="créer une app"/> en haut à droite.</li>
              <li>Choisissez <UiLabel en="Start from Dev Dashboard" fr="partir du Dev Dashboard"/>, nommez l’app <strong>YrelCompta</strong>, puis cliquez sur <UiLabel en="Create" fr="créer"/>.</li>
            </ol>
          </li>
          <li>
            <h3>Donner les permissions nécessaires</h3>
            <ol>
              <li>Dans l’app, ouvrez l’onglet <UiLabel en="Versions"/>.</li>
              <li><UiLabel en="App URL" fr="adresse de l’app"/> : laissez la valeur par défaut <code>{DEFAULT_APP_URL}</code>.</li>
              <li><UiLabel en="Webhooks API version" fr="version de l’API des webhooks"/> : choisissez la plus récente.</li>
              <li><UiLabel en="Scopes" fr="permissions"/> : ajoutez exactement {SHOPIFY_REQUIRED_SCOPES.map((scope, index) => <span key={scope}>{index > 0 && " et "}<code>{scope}</code></span>)}.</li>
              <li>Cliquez sur <UiLabel en="Release" fr="publier"/> pour enregistrer cette version.</li>
            </ol>
            <p className="shopify-guide-note">YrelCompta ne demande que la <strong>lecture</strong> des commandes et des produits : il ne peut rien modifier dans votre boutique.</p>
          </li>
          <li>
            <h3>Installer l’app sur votre boutique</h3>
            <ol>
              <li>Toujours dans l’app, cliquez sur <UiLabel en="Install app" fr="installer l’app"/> dans le cadre <UiLabel en="Installs"/>.</li>
              <li>Dans l’onglet qui s’ouvre, sélectionnez votre boutique puis cliquez sur <UiLabel en="Install" fr="installer"/>.</li>
            </ol>
          </li>
          <li>
            <h3>Copier les identifiants de l’app</h3>
            <ol>
              <li>Dans l’app, ouvrez <UiLabel en="Settings" fr="paramètres"/>.</li>
              <li>Dans le cadre <UiLabel en="Credentials" fr="identifiants"/>, copiez le <strong>Client ID</strong> et le <strong>Client secret</strong> (il faut l’afficher avant de le copier).</li>
            </ol>
            <p className="shopify-guide-note">Le Client secret est comme un mot de passe : ne l’envoyez à personne, collez-le uniquement dans le formulaire ci-dessous.</p>
          </li>
          <li>
            <h3>Remplir le formulaire YrelCompta</h3>
            <ol>
              <li><strong>Boutique Shopify</strong> : l’adresse technique de la boutique, qui se termine par <code>.myshopify.com</code>. Si l’adresse de votre administration est <code>admin.shopify.com/store/ma-boutique</code>, saisissez <code>ma-boutique.myshopify.com</code>.</li>
              <li><strong>Client ID</strong> et <strong>Client Secret</strong> : collez les valeurs copiées à l’étape 4.</li>
              <li>Cliquez sur <strong>Connecter Shopify</strong>. YrelCompta vérifie la boutique, la devise et les permissions, puis active automatiquement 5 notifications (webhooks) : commande créée, modifiée, payée, annulée et remboursement.</li>
            </ol>
          </li>
        </ol>

        <div className="shopify-guide-block">
          <h3>Ce que fait la connexion</h3>
          <ul>
            <li>Chaque commande <strong>payée</strong> devient une vente du canal Shopify, visible dans <strong>Ventes → Commandes Shopify</strong>.</li>
            <li>Les articles sont reliés à vos produits YrelCompta par leur <strong>SKU</strong> ; sinon, vous les reliez une seule fois et c’est mémorisé.</li>
            <li>Quand tout concorde, la vente est <strong>validée</strong> et l’encaissement enregistré (frais Shopify Payments déduits) ; sinon elle attend en brouillon.</li>
            <li>Les annulations et remboursements Shopify vous sont <strong>signalés</strong> pour être enregistrés.</li>
            <li>Seul le <strong>nom</strong> de la cliente est repris : ni e-mail, ni téléphone, ni adresse.</li>
          </ul>
        </div>

        <div className="shopify-guide-block">
          <h3>Sécurité</h3>
          <ul>
            <li>Le Client secret est chiffré et n’est plus jamais affiché après l’enregistrement.</li>
            <li>Pour changer de Client secret, utilisez <strong>Remplacer les identifiants</strong> : l’ancien reste accepté une heure le temps que Shopify bascule.</li>
            <li><strong>Déconnecter Shopify</strong> supprime les identifiants enregistrés et les webhooks YrelCompta de votre boutique.</li>
          </ul>
        </div>

        <div className="shopify-guide-block">
          <h3>En cas de problème</h3>
          <dl className="shopify-guide-troubleshooting">
            {troubleshooting.map((item) => <div key={item.problem}><dt>{item.problem}</dt><dd>{item.solution}</dd></div>)}
          </dl>
        </div>
      </div>
    </details>
  </section>;
}
