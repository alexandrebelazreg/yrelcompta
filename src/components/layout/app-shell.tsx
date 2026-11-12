import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";
import { MobileTabBar } from "./mobile-tab-bar";
import { Navigation } from "./navigation";

export function AppShell({ children, email, businessName }: { children: ReactNode; email: string | null; businessName: string }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="brand light">YrelCompta</span>
          <p className="business-label">{businessName}</p>
        </div>
        <Navigation />
        <form action={signOutAction} className="user-menu">
          <div>
            <span className="avatar" aria-hidden="true">{email?.charAt(0).toUpperCase() ?? "Y"}</span>
            <span className="user-details"><small>Mon espace</small><span className="user-email">{email}</span></span>
          </div>
          <button type="submit">Se déconnecter</button>
        </form>
      </aside>
      <header className="mobile-header">
        <span className="mobile-brand-group"><span className="brand">YrelCompta</span><small>{businessName}</small></span>
      </header>
      <MobileTabBar email={email} businessName={businessName} />
      <main className="app-content">{children}</main>
    </div>
  );
}
