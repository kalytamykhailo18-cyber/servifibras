"use client";

/**
 * Bloque B item 4 — Ventas unificadas dashboard card.
 *
 * Marcos 2026-06-06 ask: a single panel that rolls up sales across
 * every channel — ML cuenta 1, ML cuenta 2, TiendaNube, CRM-manual —
 * so he sees the full business volume in one view. Toggles between
 * hoy / esta semana / este mes; each source surfaces count + amount
 * (per currency when more than one is present).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/endpoints";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBagOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import RefreshIcon from "@mui/icons-material/Refresh";
import LaunchIcon from "@mui/icons-material/Launch";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { VentasDetailDialog } from "./ventas-detail-dialog";

type Range = "today" | "week" | "month";

interface Payload {
  range: Range;
  fromIso: string;
  toIso: string;
  sources: Array<{
    source: "ML_CUENTA_1" | "ML_CUENTA_2" | "TIENDANUBE" | "MANUAL";
    label: string;
    byCurrency: Array<{ currency: string; count: number; amount: number }>;
    totalArsLike: number | null;
    count: number;
  }>;
  daily: Array<{
    date: string;
    sources: Record<
      "ML_CUENTA_1" | "ML_CUENTA_2" | "TIENDANUBE" | "MANUAL",
      number
    >;
  }>;
  notes: string[];
}

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "today", label: "Hoy" },
  { id: "week", label: "Últimos 7 días" },
  { id: "month", label: "Últimos 30 días" },
];

const SOURCE_VISUALS: Record<
  Payload["sources"][number]["source"],
  { tint: string; icon: any; iconColor: string; barFill: string; barLabel: string }
> = {
  ML_CUENTA_1: { tint: "from-yellow-50 to-yellow-100 border-yellow-200", icon: StorefrontIcon, iconColor: "text-yellow-700", barFill: "#eab308", barLabel: "ML C1" },
  ML_CUENTA_2: { tint: "from-amber-50 to-amber-100 border-amber-200", icon: StorefrontIcon, iconColor: "text-amber-700", barFill: "#d97706", barLabel: "ML C2" },
  TIENDANUBE:  { tint: "from-sky-50 to-sky-100 border-sky-200",         icon: ShoppingBagIcon, iconColor: "text-sky-700", barFill: "#0ea5e9", barLabel: "TN" },
  MANUAL:      { tint: "from-emerald-50 to-emerald-100 border-emerald-200", icon: WhatsAppIcon, iconColor: "text-emerald-700", barFill: "#10b981", barLabel: "Manual" },
};

const SOURCE_STACK_ORDER: Payload["sources"][number]["source"][] = [
  "ML_CUENTA_1",
  "ML_CUENTA_2",
  "TIENDANUBE",
  "MANUAL",
];

function fmtDayLabel(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${dd}/${mm}`;
}

function fmtDayTooltip(iso: string, sources: Record<Payload["sources"][number]["source"], number>): string {
  const total = SOURCE_STACK_ORDER.reduce((s, k) => s + (sources[k] || 0), 0);
  const lines = [
    `${iso}`,
    `Total: ARS ${total.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`,
  ];
  for (const k of SOURCE_STACK_ORDER) {
    const v = sources[k] || 0;
    if (v > 0) lines.push(`${SOURCE_VISUALS[k].barLabel}: ${v.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`);
  }
  return lines.join("\n");
}

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

export function VentasUnificadasCard() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Bloque B item 5 — drilldown modal state. `detailSource=null`
  // means closed; setting a source opens the modal for that cell.
  const [detailSource, setDetailSource] = useState<
    Payload["sources"][number]["source"] | null
  >(null);
  // Bloque B item 6 — Drive upload state. `driveStatus.kind` drives
  // the small status line under the action row. `link` survives until
  // the next click so the operator can copy it out of the panel.
  const [driveStatus, setDriveStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading" }
    | { kind: "ok"; link: string; mocked: boolean; fileName: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const load = async (r: Range) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.analytics.getVentasUnificadas(r);
      setData(d as any);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar ventas unificadas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(range);
  }, [range]);

  // Reset Drive status whenever the range changes — the previous link
  // points at a snapshot for a different range.
  useEffect(() => {
    setDriveStatus({ kind: "idle" });
  }, [range]);

  const uploadToDrive = async () => {
    setDriveStatus({ kind: "uploading" });
    try {
      const res = await api.analytics.uploadVentasUnificadasToDrive(range);
      if (res.success && res.data) {
        setDriveStatus({
          kind: "ok",
          link: res.data.webViewLink,
          mocked: res.data.mocked,
          fileName: res.data.fileName,
        });
      } else {
        const msg =
          res.reason === "no-drive-config"
            ? "Drive no está configurado en el servidor"
            : res.error || "No se pudo subir a Drive";
        setDriveStatus({ kind: "error", message: msg });
      }
    } catch (err: any) {
      setDriveStatus({
        kind: "error",
        message: err?.message || "No se pudo subir a Drive",
      });
    }
  };

  // Grand total ARS-like across all sources (for the headline).
  const totalArs = data
    ? data.sources.reduce((sum, s) => {
        const ars = s.byCurrency.find((c) => c.currency === "ARS");
        return sum + (ars?.amount ?? 0);
      }, 0)
    : 0;
  const totalCount = data ? data.sources.reduce((sum, s) => sum + s.count, 0) : 0;

  return (
    <div
      className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      data-testid="ventas-unificadas-card"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AttachMoneyIcon sx={{ fontSize: 20 }} className="text-emerald-600" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Ventas unificadas
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={uploadToDrive}
            disabled={driveStatus.kind === "uploading" || !data}
            data-testid="ventas-upload-drive"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-medium text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Subir a Drive"
            title="Subir snapshot a Google Drive"
          >
            <CloudUploadIcon
              sx={{ fontSize: 14 }}
              className={driveStatus.kind === "uploading" ? "animate-pulse text-emerald-500" : "text-emerald-600"}
            />
            {driveStatus.kind === "uploading" ? "Subiendo…" : "Subir a Drive"}
          </button>
          <button
            type="button"
            onClick={() => load(range)}
            disabled={loading}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-600 hover:border-slate-300 disabled:opacity-60"
            aria-label="Refrescar"
          >
            <RefreshIcon sx={{ fontSize: 12 }} className={loading ? "animate-spin" : ""} />
            {loading ? "…" : "Refrescar"}
          </button>
        </div>
      </div>

      {/* Range toggle */}
      <div className="mb-3 flex flex-wrap gap-1.5" data-testid="ventas-range-tabs">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            data-testid={`ventas-range-${r.id}`}
            aria-pressed={range === r.id}
            className={
              "inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors " +
              (range === r.id
                ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50")
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Drive upload status — short, in-panel feedback so the operator
          doesn't need a toast system to see what happened. */}
      {driveStatus.kind === "ok" && (
        <div
          className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800"
          data-testid="ventas-drive-ok"
        >
          <span className="truncate">
            {driveStatus.mocked ? "Subida simulada · " : "Subido a Drive · "}
            <span className="font-mono" data-testid="ventas-drive-filename">
              {driveStatus.fileName}
            </span>
          </span>
          <a
            href={driveStatus.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-emerald-700 underline-offset-2 hover:underline"
            data-testid="ventas-drive-link"
          >
            Abrir
            <LaunchIcon sx={{ fontSize: 11 }} />
          </a>
        </div>
      )}
      {driveStatus.kind === "error" && (
        <p
          className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700"
          data-testid="ventas-drive-error"
        >
          {driveStatus.message}
        </p>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {!data && !error && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100/70" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Grand total */}
          <div className="mb-3 rounded-xl bg-emerald-600 px-4 py-3 text-white shadow-sm">
            <p className="text-[10px] uppercase tracking-wider opacity-80">Total {RANGES.find((r) => r.id === range)?.label.toLowerCase()}</p>
            <p className="font-mono text-lg font-semibold">
              {fmtMoney(totalArs, "ARS")}
            </p>
            <p className="text-[11px] opacity-90">
              {totalCount} venta{totalCount === 1 ? "" : "s"} en total
            </p>
          </div>

          {/* Per-source breakdown — Bloque B item 5: each row is
              clickable; opens a drilldown modal with the underlying
              order list. Rows with count=0 stay informational only. */}
          <ul className="space-y-2" data-testid="ventas-source-list">
            {data.sources.map((s) => {
              const v = SOURCE_VISUALS[s.source];
              const Icon = v.icon;
              const clickable = s.count > 0;
              return (
                <li
                  key={s.source}
                  data-testid={`ventas-source-${s.source}`}
                  data-clickable={clickable ? "true" : "false"}
                >
                  <button
                    type="button"
                    onClick={() => clickable && setDetailSource(s.source)}
                    disabled={!clickable}
                    title={clickable ? "Ver ventas" : "Sin ventas en este período"}
                    data-testid={`ventas-source-${s.source}-open`}
                    className={
                      `block w-full rounded-xl border bg-gradient-to-r p-3 text-left ${v.tint} ` +
                      (clickable
                        ? "hover:shadow-md transition-shadow cursor-pointer"
                        : "cursor-default opacity-90")
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <Icon sx={{ fontSize: 18 }} className={v.iconColor} />
                        <div>
                          <p className="flex items-center gap-1 text-sm font-semibold text-slate-800">
                            {s.label}
                            {clickable && (
                              <LaunchIcon sx={{ fontSize: 12 }} className="text-slate-400" />
                            )}
                          </p>
                          <p className="text-[11px] text-slate-600">
                            {s.count} venta{s.count === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {s.byCurrency.length === 0 ? (
                          <p className="font-mono text-xs text-slate-500">—</p>
                        ) : (
                          s.byCurrency.map((c) => (
                            <p
                              key={c.currency}
                              className="font-mono text-xs tabular-nums text-slate-800"
                            >
                              {fmtMoney(c.amount, c.currency)}
                            </p>
                          ))
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <VentasDetailDialog
            open={detailSource !== null}
            onOpenChange={(v) => {
              if (!v) setDetailSource(null);
            }}
            range={range}
            source={detailSource}
          />

          {/* Bloque B item 4 — Marcos 2026-06-06: la card ya devolvía
              el bucket diario del backend pero nunca se renderizaba;
              agregado 2026-08-11 como stacked bars por día. En "hoy"
              es un solo barrote (mostramos igual para consistencia).
              Colores del SVG mapean 1:1 con los del stack por fuente,
              hover en cada barra abre tooltip nativo con el desglose. */}
          {range !== "today" && data.daily.length > 0 && (
            <TrendChart daily={data.daily} range={range} />
          )}

          {data.notes.length > 0 && (
            <ul className="mt-3 space-y-1">
              {data.notes.map((n, i) => (
                <li key={i} className="text-[11px] text-slate-500">
                  · {n}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface TrendChartProps {
  daily: Payload["daily"];
  range: Range;
}

function TrendChart({ daily, range }: TrendChartProps) {
  const totalsPerDay = daily.map((d) =>
    SOURCE_STACK_ORDER.reduce((s, k) => s + (d.sources[k] || 0), 0),
  );
  const maxTotal = Math.max(1, ...totalsPerDay);
  const barCount = daily.length;
  const gap = 4;
  const chartH = 90;
  const axisH = 14;
  const svgH = chartH + axisH;
  const labelEvery = range === "month" ? Math.max(1, Math.ceil(barCount / 8)) : 1;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="ventas-daily-trend">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Ventas por día
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {SOURCE_STACK_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-[10px] text-slate-600">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: SOURCE_VISUALS[s].barFill }}
              />
              {SOURCE_VISUALS[s].barLabel}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label="Ventas por día apiladas por fuente"
          width="100%"
          height={svgH}
          viewBox={`0 0 ${Math.max(barCount * 20, 200)} ${svgH}`}
          preserveAspectRatio="none"
          className="min-w-full"
        >
          {daily.map((d, i) => {
            const totalW = Math.max(barCount * 20, 200);
            const barW = Math.max(1, (totalW - gap * (barCount + 1)) / barCount);
            const x = gap + i * (barW + gap);
            const dayTotal = totalsPerDay[i];
            const scale = chartH / maxTotal;
            let yCursor = chartH;
            const segments = SOURCE_STACK_ORDER.map((src) => {
              const v = d.sources[src] || 0;
              if (v <= 0) return null;
              const h = v * scale;
              yCursor -= h;
              return (
                <rect
                  key={src}
                  x={x}
                  y={yCursor}
                  width={barW}
                  height={h}
                  fill={SOURCE_VISUALS[src].barFill}
                />
              );
            });
            return (
              <g key={d.date} data-testid={`ventas-daily-bar-${d.date}`}>
                <title>{fmtDayTooltip(d.date, d.sources)}</title>
                {/* baseline stub so days without ventas still render as a hairline */}
                {dayTotal === 0 && (
                  <rect x={x} y={chartH - 1} width={barW} height={1} fill="#cbd5e1" />
                )}
                {segments}
                {(i % labelEvery === 0 || i === barCount - 1) && (
                  <text
                    x={x + barW / 2}
                    y={svgH - 2}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#64748b"
                  >
                    {fmtDayLabel(d.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
