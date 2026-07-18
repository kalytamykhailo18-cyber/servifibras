"use client";

// Marcos 2026-07-18: la CRM ya se quedó dos veces con Baileys
// desvinculado del celular por 48h sin que se notara — los clientes
// escribieron por WhatsApp y no recibieron nada. Este banner sale en
// TODAS las páginas del dashboard cuando /health reporta whatsapp
// down/degraded. Rojo cuando down, ámbar cuando degraded, silencioso
// cuando ok. Poll cada 30s — barato y visible.

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api/client";

type WhatsappHealth = {
  status: "ok" | "degraded" | "down" | "unconfigured";
  details?: {
    connectionStatus?: string;
    lastError?: string | null;
    connectedJid?: string | null;
    accountLabel?: string;
  };
};

const POLL_MS = 30_000;

export function WhatsappStatusBanner() {
  const [wa, setWa] = useState<WhatsappHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const r = await apiClient.get("/health");
        const w = r.data?.components?.whatsapp as WhatsappHealth | undefined;
        if (!cancelled) setWa(w ?? null);
      } catch {
        // Health endpoint itself unreachable — banner stays quiet;
        // the auth-side redirect will already be handling the outage.
      }
    };

    poll();
    interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  if (!wa) return null;
  if (wa.status === "ok" || wa.status === "unconfigured") return null;

  const isDown = wa.status === "down";
  const conn = wa.details?.connectionStatus ?? "?";
  const bg = isDown ? "bg-red-600" : "bg-amber-500";
  const label = isDown ? "WhatsApp desconectado" : "WhatsApp reconectando";
  const detail = isDown
    ? "El celular cerró la sesión y no está entrando ningún mensaje nuevo por WhatsApp. Escaneá el QR de nuevo."
    : `Estado actual: ${conn}. Si tarda más de un par de minutos, escaneá el QR.`;

  return (
    <div className={`${bg} text-white px-4 py-2 text-sm flex items-center justify-between shadow`}>
      <div className="flex-1">
        <span className="font-semibold">{label}</span>
        <span className="ml-2 opacity-90">{detail}</span>
      </div>
      <Link
        href="/settings"
        className="ml-4 shrink-0 rounded bg-white/20 px-3 py-1 font-medium hover:bg-white/30"
      >
        Ir a Ajustes
      </Link>
    </div>
  );
}
