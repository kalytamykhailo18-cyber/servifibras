"use client";

// Bloque C — Marcos 2026-06-06.
// Pinned-at-the-top section of the daily logistics Excel. Two things:
//   1. Links favoritos — shortcut rows to Drive resources the warehouse
//      keeps an eye on (ubicación de moldes, calculador de láminas,
//      seguimiento de tareas, mayoristas, errores). One label + one URL
//      per row; operator adds / removes rows freely.
//   2. Notas operativas — free-form text block printed under the links
//      for whatever the operator wants visible at the top of the file
//      on a given day.
// Both values land in Configuration ("logistica_settings") and the
// daily Excel generator pulls them automatically — no one re-types
// anything between days.

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import AddLinkIcon from "@mui/icons-material/AddLink";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import SaveIcon from "@mui/icons-material/Save";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

type LinkRow = { label: string; url: string };

interface LogisticaConfig {
  linksFavoritos: LinkRow[];
  notasOperativas: string;
  /** Marcos 2026-06-10: editable list of flex couriers. The
   *  logística panel's "Asignar courier" dropdown reads from this. */
  flexCouriers: string[];
  /** Marcos 2026-06-10: per-family pickup cutoff hours (0-23 in
   *  America/Argentina/Buenos_Aires). After this hour, the
   *  carrier of that family has already picked up — orders that
   *  arrived after the cutoff are "para mañana". Editable so
   *  Marcos can tune the colecta cutoff when ML changes their
   *  pickup window. null = no cutoff banner for that family. */
  cutoffHours: {
    colecta: number | null;
    flex: number | null;
    motos: number | null;
    micros: number | null;
  };
}

const DEFAULT_CUTOFFS = { colecta: 14, flex: 15, motos: 15, micros: null as number | null };
const EMPTY: LogisticaConfig = {
  linksFavoritos: [],
  notasOperativas: "",
  flexCouriers: [],
  cutoffHours: { ...DEFAULT_CUTOFFS },
};

export function LogisticaForm() {
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<LogisticaConfig>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.config.getLogistica();
        if (!cancelled) {
          setState({
            linksFavoritos: Array.isArray(cfg?.linksFavoritos) ? cfg.linksFavoritos : [],
            notasOperativas: typeof cfg?.notasOperativas === "string" ? cfg.notasOperativas : "",
            // Marcos 2026-06-10: prefer the editable DB value;
            // when unset (fresh install / pre-feature config row),
            // fall back to whatever the backend exposes via the
            // logística panel endpoint so the UI shows the live
            // env defaults instead of a blank list.
            flexCouriers: Array.isArray(cfg?.flexCouriers) && cfg.flexCouriers.length > 0
              ? cfg.flexCouriers
              : await api.dailyLogistica.listFlexCouriers().catch(() => []),
            cutoffHours: {
              colecta: typeof cfg?.cutoffHours?.colecta === "number" ? cfg.cutoffHours.colecta : DEFAULT_CUTOFFS.colecta,
              flex: typeof cfg?.cutoffHours?.flex === "number" ? cfg.cutoffHours.flex : DEFAULT_CUTOFFS.flex,
              motos: typeof cfg?.cutoffHours?.motos === "number" ? cfg.cutoffHours.motos : DEFAULT_CUTOFFS.motos,
              micros: typeof cfg?.cutoffHours?.micros === "number" ? cfg.cutoffHours.micros : DEFAULT_CUTOFFS.micros,
            },
          });
        }
      } catch (err: any) {
        if (!cancelled) toast.error(err?.message ?? "No se pudo cargar la configuración de Logística");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addLink = () => {
    setState((s) => ({ ...s, linksFavoritos: [...s.linksFavoritos, { label: "", url: "" }] }));
  };
  const updateLink = (idx: number, patch: Partial<LinkRow>) => {
    setState((s) => ({
      ...s,
      linksFavoritos: s.linksFavoritos.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };
  const removeLink = (idx: number) => {
    setState((s) => ({ ...s, linksFavoritos: s.linksFavoritos.filter((_, i) => i !== idx) }));
  };

  const save = async () => {
    // Strip empty rows so a forgotten "+ Agregar link" doesn't ship.
    const cleanLinks = state.linksFavoritos
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label.length > 0 || l.url.length > 0);
    const cleanCouriers = state.flexCouriers
      .map((c) => c.trim())
      .filter(Boolean);
    if (cleanCouriers.length === 0) {
      toast.error("Tiene que haber al menos una logística");
      return;
    }
    const payload = {
      linksFavoritos: cleanLinks,
      notasOperativas: state.notasOperativas,
      flexCouriers: cleanCouriers,
      cutoffHours: state.cutoffHours,
    };
    try {
      setSaving(true);
      const r = await api.config.updateLogistica(payload);
      // Marcos 2026-06-10: the panel's POST /flex-couriers endpoint
      // is the source of truth for the dropdown — persist there too
      // so the daily panel reads the new list on next refresh.
      await api.dailyLogistica.updateFlexCouriers(cleanCouriers).catch((err) => {
        toast.error(`Logísticas guardadas en config pero no se sincronizaron al panel: ${err?.message ?? 'error desconocido'}`);
      });
      if (r.success) {
        toast.success("Configuración de Logística guardada");
        setState(payload);
      } else {
        toast.error(r.error ?? "No se pudo guardar");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* HEADER CARD */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white">
            <LocalShippingIcon sx={{ fontSize: 20 }} />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Logística — encabezado del archivo diario</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Lo que ves acá se publica al inicio del Excel automático que recibe el equipo todos los días. Los links se mantienen pinneados; las notas son libres para lo que haga falta destacar.
            </p>
          </div>
        </div>
      </div>

      {/* LINKS CARD */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Links favoritos</h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Una fila por link: etiqueta visible (lo que lee el armador) + URL completa.
            </p>
          </div>
          <button
            type="button"
            onClick={addLink}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:opacity-60"
          >
            <AddLinkIcon sx={{ fontSize: 16 }} className="text-amber-600" />
            Agregar link
          </button>
        </div>

        {state.linksFavoritos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500">
            Sin links cargados. Tocá "Agregar link" para sumar el primero — por ejemplo "Ubicación de moldes" + URL del Drive.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="logistica-links-list">
            {state.linksFavoritos.map((link, idx) => (
              <li
                key={idx}
                className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 sm:grid-cols-[200px_minmax(0,1fr)_auto]"
              >
                <Input
                  value={link.label}
                  onChange={(e) => updateLink(idx, { label: e.target.value })}
                  placeholder="Etiqueta — ej. Ubicación de moldes"
                  disabled={saving}
                  className="bg-white"
                />
                <Input
                  value={link.url}
                  onChange={(e) => updateLink(idx, { url: e.target.value })}
                  placeholder="https://docs.google.com/…"
                  disabled={saving}
                  className="bg-white"
                />
                <div className="flex items-center justify-end gap-1">
                  {link.url && (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir en nueva pestaña"
                      className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <OpenInNewIcon sx={{ fontSize: 16 }} />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => removeLink(idx)}
                    disabled={saving}
                    aria-label="Eliminar link"
                    className="grid h-9 w-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Marcos 2026-06-10: WAREHOUSE LOCATIONS CARD — bulk upload
          a (SKU, ubicación) sheet. The daily logística panel pulls
          Product.warehouseLocation by SKU and renders "UBI: …" as
          a teal pill on every item line, so the armador knows
          where in the galpón to grab the box. Accepts .xlsx or
          .csv. Returns a summary with the matched / updated counts
          + any SKUs in the sheet that don't exist in the catalog
          (typos / discontinued). */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Ubicación de productos en el galpón</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            Subí una planilla con 2 columnas (<code className="rounded bg-slate-100 px-1">sku</code> y <code className="rounded bg-slate-100 px-1">ubicación</code>). La etiqueta <span className="font-semibold text-teal-700">UBI: …</span> aparece al lado de cada SKU en el panel diario para que el armador sepa de dónde levantar la caja.
          </p>
        </div>
        <input
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          data-testid="warehouse-locations-input"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const r = await api.dailyLogistica.uploadWarehouseLocations(file);
              toast.success(`Ubicaciones cargadas — ${r.matched} SKUs actualizados de ${r.parsedRows} filas${r.unmatchedSkus.length > 0 ? ` (${r.unmatchedSkus.length} sin coincidencia)` : ''}`);
            } catch (err: any) {
              toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo procesar el archivo");
            } finally {
              e.target.value = "";
            }
          }}
          disabled={saving}
          className="block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-3 text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-amber-800 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-60"
        />
      </div>

      {/* Marcos 2026-06-10: CUTOFF HOURS CARD — when does each
          carrier family pick up for the day. Past the cutoff, the
          daily panel draws an amber divider inside the section
          between "para mañana" (above, post-cutoff arrivals) and
          "lote de hoy" (below). Dejar vacío desactiva el corte. */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Horarios de corte</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            Hora a la que cada familia ya no toma pedidos para el día (24 hs, en hora de Argentina). Pasado el corte, el panel pone una línea divisoria amarilla en la sección para marcar lo que queda para mañana. Dejá vacío para desactivar el corte de una familia.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['colecta','flex','motos','micros'] as const).map((family) => {
            const labels = { colecta: 'Colecta (cuentas 1 y 2)', flex: 'Flex (cuentas 1 y 2)', motos: 'Motos', micros: 'Micros' } as const;
            const value = state.cutoffHours[family];
            return (
              <label key={family} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{labels[family]}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={value == null ? '' : String(value)}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Math.max(0, Math.min(23, Math.floor(Number(raw))));
                      setState((s) => ({ ...s, cutoffHours: { ...s.cutoffHours, [family]: Number.isFinite(next as number) ? next : null } }));
                    }}
                    disabled={saving}
                    placeholder="—"
                    data-testid={`logistica-cutoff-${family}`}
                    className="h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15 disabled:opacity-60"
                  />
                  <span className="text-xs text-slate-500">hs</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Marcos 2026-06-10: FLEX COURIERS CARD — editable list of
          the logística services that rotate through flex orders.
          Drives the "Asignar courier" dropdown on the daily
          logística panel. Marcos can rename / replace these without
          a redeploy when a service changes. */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Logísticas de Flex</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            Empresas que retiran los paquetes flex. El armador elige una de éstas en el panel diario al asignar courier al grupo.
          </p>
        </div>
        {state.flexCouriers.length === 0 ? (
          <p className="text-[12px] text-slate-500 italic">No hay logísticas configuradas — agregá la primera.</p>
        ) : (
          <ul className="space-y-2">
            {state.flexCouriers.map((c, idx) => (
              <li key={idx} className="flex items-center gap-2" data-testid={`logistica-flex-courier-row-${idx}`}>
                <input
                  type="text"
                  value={c}
                  onChange={(e) => setState((s) => ({ ...s, flexCouriers: s.flexCouriers.map((x, i) => i === idx ? e.target.value : x) }))}
                  disabled={saving}
                  placeholder="Nombre de la logística (ej: JyJ)"
                  data-testid={`logistica-flex-courier-input-${idx}`}
                  className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setState((s) => ({ ...s, flexCouriers: s.flexCouriers.filter((_, i) => i !== idx) }))}
                  disabled={saving}
                  aria-label="Eliminar logística"
                  className="grid h-9 w-9 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, flexCouriers: [...s.flexCouriers, ""] }))}
          disabled={saving || state.flexCouriers.length >= 10}
          data-testid="logistica-add-flex-courier-btn"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          + Agregar logística
        </button>
      </div>

      {/* NOTAS CARD */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Notas operativas</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            Texto libre que se imprime debajo de los links en el encabezado del archivo. Útil para feriados, ajustes puntuales del flujo, recordatorios al armador, etc.
          </p>
        </div>
        <textarea
          value={state.notasOperativas}
          onChange={(e) => setState((s) => ({ ...s, notasOperativas: e.target.value }))}
          rows={6}
          disabled={saving}
          placeholder="Notas que querés ver arriba del archivo del día."
          data-testid="logistica-notas-input"
          className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15 disabled:opacity-60"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          data-testid="logistica-save-btn"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-amber-600 to-orange-500 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(245_158_11/0.5)] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <SaveIcon sx={{ fontSize: 16 }} />
          )}
          Guardar
        </button>
      </div>
    </div>
  );
}
