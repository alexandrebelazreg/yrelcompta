import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";

const privatePrefixes = [
  "/tableau-de-bord", "/ventes", "/depenses", "/produits",
  "/documents", "/registres", "/parametres", "/demarrage",
];
const authPaths = ["/connexion", "/inscription"];

export async function updateSession(request: NextRequest) {
  const config = getSupabaseConfig();
  const path = request.nextUrl.pathname;
  if (!config) {
    if (privatePrefixes.some((prefix) => path.startsWith(prefix))) {
      const url = request.nextUrl.clone();
      url.pathname = "/connexion";
      url.searchParams.set("configuration", "requise");
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);
  if (!authenticated && privatePrefixes.some((prefix) => path.startsWith(prefix))) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.searchParams.set("retour", path);
    return NextResponse.redirect(url);
  }

  if (authenticated && authPaths.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/tableau-de-bord";
    return NextResponse.redirect(url);
  }

  return response;
}
