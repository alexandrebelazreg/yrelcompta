import Link from "next/link";
export default function NotFound() { return <main className="centered-message"><p className="eyebrow">Erreur 404</p><h1>Cette page n’existe pas</h1><p>Le lien est peut-être ancien ou incorrect.</p><Link className="button-link" href="/">Revenir à l’accueil</Link></main>; }
