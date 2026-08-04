export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export function getSupabaseConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export const missingSupabaseMessage =
  "Supabase n’est pas encore configuré. Renseignez les variables d’environnement indiquées dans le README.";
