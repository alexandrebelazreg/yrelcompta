import { createClient } from "@/lib/supabase/server";
import type { AppContext } from "@/types/database";

export async function getAuthenticatedContext(): Promise<{
  userId: string | null;
  email: string | null;
  context: AppContext;
}> {
  const supabase = await createClient();
  if (!supabase) return { userId: null, email: null, context: { profile: null, business: null } };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { userId: null, email: null, context: { profile: null, business: null } };

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name").eq("id", user.id).maybeSingle(),
    supabase.from("business_members").select("businesses(id, name, siret, address, main_activity)").eq("user_id", user.id).limit(1).maybeSingle(),
  ]);
  const joined = membershipResult.data?.businesses;
  const business = Array.isArray(joined) ? joined[0] ?? null : joined ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    context: { profile: profileResult.data, business },
  };
}
