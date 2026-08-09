import Link from "next/link";
import { InfoTip } from "@/components/ui/info-tip";

const registers = [
  { href: "/registres/recettes", title: "Livre des recettes", description: "Encaissements bruts chronologiques, règlements en espèces et totaux trimestriels." },
  { href: "/registres/achats", title: "Registre des achats", description: "Règlements fournisseurs chronologiques et part professionnelle suivie séparément." },
  { href: "/registres/declarations", title: "Déclarations", description: "Calendrier, chiffre d’affaires proposé et historique immuable des révisions enregistrées." },
];

export default function RegistersPage() {
  return <>
    <header className="page-header"><div className="info-line"><h1>Registres et déclarations</h1><InfoTip label="À propos des registres et déclarations">Préparez vos registres et tracez ce que vous avez déclaré, sans transmission automatique.</InfoTip></div></header>
    <section className="register-home-grid">
      {registers.map((register) => <Link className="card register-home-card" href={register.href} key={register.href}><span aria-hidden="true">▦</span><h2>{register.title}</h2><p>{register.description}</p><strong>Ouvrir →</strong></Link>)}
    </section>
    <p className="dashboard-note">YrelCompta n’envoie aucune déclaration à l’Urssaf et ne calcule ni cotisations, ni TVA, ni impôt. Les informations et justificatifs réglementaires doivent être conservés pendant 10 ans.</p>
  </>;
}
