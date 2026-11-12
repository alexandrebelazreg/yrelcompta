import { NextResponse } from "next/server";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { publicOrigin, wwwAuthenticate } from "@/lib/mcp/metadata";
import { handleMcpMessage } from "@/lib/mcp/protocol";
import { readOnlyTools } from "@/lib/mcp/tools";
import { runWithSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

// Transport « Streamable HTTP » sans état : chaque POST reçoit une réponse JSON.
// L'authentification repose uniquement sur le jeton Bearer (aucun cookie), ce qui exclut le CSRF.
export async function POST(request: Request) {
  const origin = publicOrigin(request.url);
  const auth = await authenticateMcpRequest(request.headers.get("authorization"));
  if (!auth.ok) {
    const headers: Record<string, string> = {};
    if (auth.status === 401 || auth.status === 403) headers["WWW-Authenticate"] = wwwAuthenticate(origin, auth.error, auth.description);
    return NextResponse.json({ error: auth.error, error_description: auth.description }, { status: auth.status, headers });
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const response = await runWithSupabaseClient(auth.session.supabase, () => handleMcpMessage(body, readOnlyTools, auth.session));
  if (response === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}

// Ce serveur n'ouvre pas de flux SSE et ne garde pas de session : GET et DELETE sont refusés (spécification MCP).
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
