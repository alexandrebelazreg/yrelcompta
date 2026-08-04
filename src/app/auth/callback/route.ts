import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/demarrage";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/demarrage";
  const origin = request.nextUrl.origin;
  const supabase = await createClient();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("Échec du callback d’authentification Supabase", { code: error.code });
  }
  return NextResponse.redirect(`${origin}/connexion?erreur=confirmation`);
}
