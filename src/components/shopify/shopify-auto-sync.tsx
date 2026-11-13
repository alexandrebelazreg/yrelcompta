"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { autoSyncShopifyAction } from "@/lib/shopify/order-actions";

/** Lance une synchronisation à l'ouverture de la page si la dernière est ancienne, puis rafraîchit l'affichage. */
export function ShopifyAutoSync() {
  const router = useRouter();
  const started = useRef(false);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    autoSyncShopifyAction()
      .then((result) => { if (result.synced) router.refresh(); })
      .catch(() => undefined)
      .finally(() => setSyncing(false));
  }, [router]);

  return syncing ? <p className="shopify-sync-progress" role="status">Synchronisation des commandes Shopify en cours…</p> : null;
}
