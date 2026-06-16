"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy /mercadolibre route — 2026-06-03 standalone page, then 2026-06-04
 * Marcos asked to fold it into /conversations as a sub-tab to keep the
 * sidebar light. This redirect preserves any bookmarks pointing here.
 */
export default function MercadolibreRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/conversations?view=mercadolibre");
  }, [router]);
  return null;
}
