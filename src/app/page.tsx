import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/auth/context";

export default async function HomePage() {
  const { userId, context } = await getAuthenticatedContext();
  if (userId) redirect(context.business ? "/tableau-de-bord" : "/demarrage");
  return (
    <main>
      <header className="public-header"><Link className="brand" href="/">YrelCompta</Link><nav aria-label="Navigation principale"><Link href="/connexion">Se connecter</Link><Link className="button-link" href="/inscription">Créer mon espace</Link></nav></header>
      <section className="hero">
        <div><p className="eyebrow">Pensé pour les créatrices indépendantes</p><h1>La gestion simple de votre micro-entreprise de bijoux.</h1><p className="hero-copy">Un espace clair et rassurant pour préparer le suivi de votre activité, sans jargon inutile.</p><div className="hero-actions"><Link className="button-link" href="/inscription">Créer mon espace</Link><Link className="secondary-link" href="/connexion">Se connecter</Link></div></div>
        <div className="jewel-card" aria-hidden="true"><span>Y</span><p>Votre activité,<br />en toute clarté.</p></div>
      </section>
      <section className="features" aria-labelledby="features-title"><div><p className="eyebrow">Bientôt dans votre espace</p><h2 id="features-title">Les essentiels réunis au même endroit</h2></div><div className="feature-grid">{[["Ventes", "Suivez simplement vos encaissements."], ["Dépenses", "Centralisez vos achats et justificatifs."], ["Documents", "Préparez vos documents commerciaux."], ["Registres", "Organisez les registres de votre activité."]].map(([title, text]) => <article className="feature" key={title}><span aria-hidden="true">✦</span><h3>{title}</h3><p>{text}</p><small>Fonctionnalité à venir</small></article>)}</div></section>
      <footer>© {new Date().getFullYear()} YrelCompta · Conçu pour une gestion sereine.</footer>
    </main>
  );
}
