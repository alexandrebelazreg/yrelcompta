import { NextResponse } from "next/server";
import { protectedResourceMetadata, publicOrigin } from "@/lib/mcp/metadata";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

// Servi à la racine et sous le chemin de la ressource (/.well-known/oauth-protected-resource/api/mcp).
export function GET(request: Request) {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(protectedResourceMetadata(publicOrigin(request.url), config.url), {
    headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
