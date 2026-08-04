import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { getAuthenticatedContext } from "@/lib/auth/context";

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const { userId, email, context } = await getAuthenticatedContext();
  if (!userId) redirect("/connexion");
  if (!context.business) redirect("/demarrage");
  return <AppShell email={email} businessName={context.business.name}>{children}</AppShell>;
}
