"use client";

// Marcos 2026-06-30: banner contextual en el panel "Listas para
// despachar" / "Pendientes" que aparece cuando hay rows con
// resolvedCarrier='Sin asignar'. Para ADMIN, expone un botón
// "Aplicar recomendaciones automáticas" inline que setea
// postal_code_zones.defaultCarrier a la mensajería sugerida
// (mineada del histórico de operator-picks), sin que el operador
// tenga que navegar a Configuración. Para no-admin queda en
// link informativo a Configuración (que de todas formas requiere
// admin para aplicar).

import { useCallback, useEffect, useState } from "react";
import { api, type AggregatedDay } from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { toast } from "sonner";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

type Recommendation = {
  zone: string;
  recommendedCarrier: string;
  confidence: number;
  sampleSize: number;
  currentDefault: string | null;
};

export function SinAsignarBanner({
  data,
  tab,
  onApplied,
  userRole,
}: {
  data: AggregatedDay | null;
  tab: 'pendientes' | 'listas' | 'despachadas';
  onApplied: () => void;
  userRole: UserRole | null | undefined;
}) {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [applying, setApplying] = useState(false);

  // Cargar recomendaciones disponibles para mostrar en el botón inline.
  // Solo si admin (los demás no pueden aplicar de todos modos).
  useEffect(() => {
    if (userRole !== UserRole.ADMIN) return;
    api.dailyLogistica.zoneCarrierRecommendations()
      .then((rows) => setRecs(rows.filter((r) => !r.currentDefault && r.confidence >= 0.60)))
      .catch(() => setRecs([]));
  }, [userRole]);

  if (tab === 'despachadas') return null;
  if (!data?.carrierSummary) return null;
  const sinAsignar = data.carrierSummary.find((c) => c.carrier === 'Sin asignar');
  const tabKey: 'pending' | 'listas' = tab === 'pendientes' ? 'pending' : 'listas';
  const sinCount = sinAsignar ? sinAsignar[tabKey] : 0;
  if (sinCount === 0) return null;

  const isAdmin = userRole === UserRole.ADMIN;
  const hasRecs = recs && recs.length > 0;

  const onApply = async () => {
    if (!hasRecs) return;
    setApplying(true);
    try {
      const selections = recs!.map((r) => ({ zone: r.zone, carrier: r.recommendedCarrier }));
      const res = await api.dailyLogistica.applyZoneCarrierRecommendations(selections);
      toast.success(`Aplicadas ${selections.length} recomendaciones — ${res.updated} CPs actualizados`);
      onApplied();
    } catch (e: any) {
      toast.error(e?.message || "no se pudo aplicar");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-2.5 text-xs">
      <WarningAmberIcon sx={{ fontSize: 16 }} className="text-amber-600" />
      <span className="text-amber-900">
        <span className="font-semibold tabular-nums">{sinCount}</span> {sinCount === 1 ? "pedido" : "pedidos"} sin mensajería asignada.
      </span>
      {isAdmin && hasRecs && (
        <span className="text-[11px] text-amber-700">
          Sugerencias automáticas: {recs!.map((r) => `${r.zone} → ${r.recommendedCarrier}`).join(" · ")}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {isAdmin && hasRecs ? (
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-1 font-semibold text-white shadow-sm transition hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AutoAwesomeIcon sx={{ fontSize: 14 }} />
            {applying ? "Aplicando…" : `Aplicar ${recs!.length} sugerencia${recs!.length === 1 ? "" : "s"}`}
          </button>
        ) : (
          <a
            href="/configuracion?tab=logistica"
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 transition hover:bg-amber-50"
          >
            Configurar mensajería por zona →
          </a>
        )}
      </div>
    </div>
  );
}
