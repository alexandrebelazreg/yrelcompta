import Link from "next/link";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";

export default function SettingsPage() {
  return <>
    <header className="page-header"><div className="info-line"><h1>Paramètres</h1><InfoTip label="À propos des paramètres">Configurez les informations utilisées par les futurs documents YrelCompta.</InfoTip></div></header>
    <section className="settings-grid"><Card><div className="info-line"><h2>Facturation</h2><InfoTip label="À propos des paramètres de facturation">Identité légale, mention de franchise de TVA et conditions B2B snapshotées à l’émission.</InfoTip></div><Link className="button-link" href="/parametres/facturation">Configurer la facturation</Link></Card><Card><div className="info-line"><h2>Fiscalité et cotisations</h2><InfoTip label="À propos des paramètres fiscaux et sociaux">Profil de l’entreprise, références légales en lecture seule et historique des versions.</InfoTip></div><Link className="button-link" href="/parametres/fiscalite">Configurer la fiscalité</Link></Card></section>
  </>;
}
