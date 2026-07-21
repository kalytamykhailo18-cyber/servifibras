"use client";

// Marcos 2026-07-21: banda de actividad real arriba del Kanban de
// leads. El Kanban solo (leads table) quedó congelado sin actividad
// desde 07-14, pero el negocio sigue: conversaciones cerradas, pedidos
// nuevos, facturación. Este strip trae 3 números del /leads/stats
// endpoint (mismo que la vista de estadísticas) para que Marcos vea
// el pulso del negocio sin salir del pipeline.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/endpoints";
import { formatNumber } from "@/lib/format";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import PaidIcon from "@mui/icons-material/Paid";

interface Row {
  closed: number;
  orders: number;
  facturado: number;
  windowDays: number;
}

export function LeadsActivityStrip() {
  const [row, setRow] = useState<Row | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await api.leads.getStats();
        if (cancelled) return;
        setRow({
          closed: (s as any).closedConversationsInWindow ?? 0,
          orders: (s as any).ordersInWindow ?? 0,
          facturado: (s as any).ordersAmountArsInWindow ?? 0,
          windowDays: (s as any).activityWindowDays ?? 30,
        });
      } catch { /* silent */ }
    };
    void load();
    const iv = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);
  if (!row) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
      <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Actividad · últimos {row.windowDays} días
      </span>
      <StripItem icon={ChatBubbleOutlineIcon} label="Conversaciones cerradas" value={String(row.closed)} tint="text-slate-700" />
      <StripItem icon={ShoppingCartIcon} label="Pedidos generados" value={String(row.orders)} tint="text-indigo-700" />
      <StripItem icon={PaidIcon} label="Facturado" value={`$${formatNumber(row.facturado)}`} tint="text-emerald-700" />
      <Link href="/leads/stats" className="ml-auto text-[11px] font-medium text-blue-700 hover:underline">
        Ver estadísticas
      </Link>
    </div>
  );
}

function StripItem({ icon: Icon, label, value, tint }: any) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <Icon sx={{ fontSize: 14 }} className={tint} />
      <span className="text-[11px] font-medium text-slate-500">{label}:</span>
      <span className={`text-[13px] font-semibold ${tint}`}>{value}</span>
    </span>
  );
}
