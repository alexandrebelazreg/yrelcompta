"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const authorizationId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const clientId = z.string().uuid();

/** L'URL de retour vient de Supabase Auth ; on vérifie tout de même qu'il s'agit d'un lien web. */
function isWebRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function externalRedirect(url: string | undefined): never {
  if (!url || !isWebRedirect(url)) redirect("/oauth/consent?erreur=redirection");
  redirect(url);
}

async function decide(formData: FormData, approve: boolean) {
  const parsed = authorizationId.safeParse(formData.get("authorizationId"));
  if (!parsed.success) redirect("/oauth/consent?erreur=demande");
  const supabase = await createClient();
  if (!supabase) redirect("/oauth/consent?erreur=configuration");
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(parsed.data, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(parsed.data, { skipBrowserRedirect: true });
  if (error || !data) {
    console.error("Décision de consentement OAuth refusée", { code: error?.code });
    redirect("/oauth/consent?erreur=demande");
  }
  externalRedirect(data.redirect_url);
}

export async function approveAuthorizationAction(formData: FormData) {
  await decide(formData, true);
}

export async function denyAuthorizationAction(formData: FormData) {
  await decide(formData, false);
}

export async function revokeConnectedAppAction(formData: FormData) {
  const parsed = clientId.safeParse(formData.get("clientId"));
  if (!parsed.success) redirect("/parametres/claude?erreur=application");
  const supabase = await createClient();
  if (!supabase) redirect("/parametres/claude?erreur=configuration");
  const { error } = await supabase.auth.oauth.revokeGrant({ clientId: parsed.data });
  if (error) {
    console.error("Révocation d’application refusée", { code: error.code });
    redirect("/parametres/claude?erreur=revocation");
  }
  revalidatePath("/parametres/claude");
  redirect("/parametres/claude?message=revoquee");
}
