import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

export interface McpSession {
  supabase: SupabaseClient;
  userId: string;
  businessId: string;
  businessName: string;
  clientId: string;
}

/** Contexte transmis aux outils : la session authentifiée et l'adresse publique du site. */
export interface McpToolContext extends McpSession {
  origin: string;
}

export type McpAuthResult =
  | { ok: true; session: McpSession }
  | { ok: false; status: 401 | 403 | 503; error: "invalid_token" | "insufficient_scope" | "unavailable"; description: string };

/** Extrait un jeton « Authorization: Bearer … » ; jamais depuis l'URL. */
export function readBearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/);
  return match ? match[1] : null;
}

/**
 * Vérifie un jeton d'accès émis par le serveur OAuth Supabase pour un client tiers (Claude).
 * Les requêtes sont ensuite faites avec ce jeton : RLS et RPC contrôlent l'accès comme dans l'app.
 */
export async function authenticateMcpRequest(authorization: string | null): Promise<McpAuthResult> {
  const config = getSupabaseConfig();
  if (!config) return { ok: false, status: 503, error: "unavailable", description: "Supabase is not configured." };
  const token = readBearerToken(authorization);
  if (!token) return { ok: false, status: 401, error: "invalid_token", description: "Missing bearer token." };

  const supabase = createSupabaseClient(config.url, config.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let claims: Record<string, unknown> | undefined;
  try {
    // getClaims lève une exception (et ne renvoie pas d'erreur) sur un jeton mal formé.
    const { data, error } = await supabase.auth.getClaims(token);
    claims = error ? undefined : data?.claims as Record<string, unknown> | undefined;
  } catch {
    claims = undefined;
  }
  if (!claims || typeof claims.sub !== "string" || claims.role !== "authenticated") {
    return { ok: false, status: 401, error: "invalid_token", description: "Invalid or expired token." };
  }
  // Seuls les jetons OAuth délivrés à une application tierce sont acceptés ici, pas les sessions du site.
  if (typeof claims.client_id !== "string" || claims.client_id === "") {
    return { ok: false, status: 401, error: "invalid_token", description: "Token was not issued to an OAuth client." };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("business_members").select("business_id,businesses(name)").eq("user_id", claims.sub).limit(1).maybeSingle();
  if (membershipError) {
    console.error("Lecture de l’entreprise du connecteur impossible", { code: membershipError.code });
    return { ok: false, status: 503, error: "unavailable", description: "Business lookup failed." };
  }
  if (!membership) return { ok: false, status: 403, error: "insufficient_scope", description: "No business is configured for this account." };
  const joined = membership.businesses as { name?: string } | Array<{ name?: string }> | null;
  const businessName = (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? "";

  return { ok: true, session: { supabase, userId: claims.sub, businessId: String(membership.business_id), businessName, clientId: claims.client_id } };
}
