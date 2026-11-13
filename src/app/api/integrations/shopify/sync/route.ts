import { NextResponse } from "next/server";
import { syncAllShopifyConnections } from "@/lib/shopify/order-sync";
import { SHOPIFY_SYNC_SIGNATURE_HEADER, verifyShopifySyncSignature } from "@/lib/shopify/sync-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Appelée toutes les 15 minutes par la fonction planifiée Netlify (netlify/functions/shopify-sync.mts).
// Seul un appel signé avec la clé secrète du serveur est accepté.
export async function POST(request: Request) {
  if (!verifyShopifySyncSignature(request.headers.get(SHOPIFY_SYNC_SIGNATURE_HEADER), process.env.SUPABASE_SECRET_KEY)) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    const summary = await syncAllShopifyConnections();
    return NextResponse.json({
      connections: summary.length,
      imported: summary.reduce((total, row) => total + row.imported, 0),
      failed: summary.reduce((total, row) => total + row.failed, 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Synchronisation planifiée Shopify impossible");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
