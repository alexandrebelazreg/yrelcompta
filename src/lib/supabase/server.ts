import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

// Client imposé pour la durée d'une requête sans cookies (connecteur Claude) :
// les requêtes métier existantes s'exécutent alors avec le jeton de l'utilisatrice, sous RLS.
const scopedClient = new AsyncLocalStorage<SupabaseClient>();

export function runWithSupabaseClient<T>(client: SupabaseClient, callback: () => Promise<T>): Promise<T> {
  return scopedClient.run(client, callback);
}

export async function createClient() {
  const scoped = scopedClient.getStore();
  if (scoped) return scoped;
  const config = getSupabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Un Server Component ne peut pas écrire de cookie. Le proxy les rafraîchit.
        }
      },
    },
  });
}
