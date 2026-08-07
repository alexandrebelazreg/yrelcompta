import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function SettingsPage() {
  return <>
    <header className="page-header"><div><p className="eyebrow">Configuration</p><h1>Paramètres</h1><p>Configurez les informations utilisées par les futurs documents YrelCompta.</p></div></header>
    <section className="settings-grid"><Card><p className="eyebrow">Documents clients</p><h2>Facturation</h2><p>Identité légale, mention de franchise de TVA et conditions B2B snapshotées à l’émission.</p><Link className="button-link" href="/parametres/facturation">Configurer la facturation</Link></Card></section>
  </>;
}
