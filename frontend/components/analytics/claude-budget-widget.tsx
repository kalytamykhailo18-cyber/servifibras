"use client";

// ADMIN-only widget showing Claude monthly spend vs cap, today's spend,
// and a breakdown by call site. Hidden for non-admin roles to keep
// per-detector usage signals out of operator hands.

import { useEffect, useState } from "react";
import { api, type ClaudeBudgetStats } from "@/lib/api/endpoints";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import BoltIcon from "@mui/icons-material/Bolt";

const CALL_SITE_LABEL: Record<string, string> = {
  reply:               "Respuestas al cliente",
  redact:              "Redactar con IA",
  ask:                 "Consulta directa",
  health:              "Healthcheck",
  "json:complexity":   "Clasificador de complejidad",
  "json:customer_type":"Tipo de cliente",
  "json:mayorista":    "Detector mayorista",
  "json:handoff_customer": "Handoff (cliente)",
  "json:handoff_ai":   "Handoff (IA)",
};

// Marcos 2026-06-24: nombres legibles para el card de Bloque E.
const COST_OPT_LABEL: Record<string, string> = {
  'faq-preai':          'FAQ pre-IA',
  'publication-faq':    'FAQ por publicación',
  'product-lookup':     'Atajo precio/stock',
  'history-compression':'Compresión de historial',
  'ml-shortcut':        'Atajo ML',
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `USD ${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
}
function fmtInt(n: number): string {
  return new Intl.NumberFormat("es-AR").format(Math.round(n));
}

export function ClaudeBudgetWidget() {
  const role = useAuthStore(selectUserRole);
  const [stats, setStats] = useState<ClaudeBudgetStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== UserRole.ADMIN) return;
    let cancelled = false;
    api.aiBudget.getStats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Error"); });
    return () => { cancelled = true; };
  }, [role]);

  if (role !== UserRole.ADMIN) return null;
  if (error) return null; // soft hide on error — non-critical widget
  if (!stats) {
    return (
      <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <p className="text-sm text-slate-500">Cargando uso de IA…</p>
      </div>
    );
  }

  const pct = stats.capUsd > 0 ? Math.min(100, Math.round((stats.monthSpentUsd / stats.capUsd) * 100)) : 0;
  const danger = pct >= 90;
  const warning = pct >= 70 && !danger;

  const barColor = danger
    ? "bg-gradient-to-r from-rose-600 to-pink-500"
    : warning
      ? "bg-gradient-to-r from-amber-500 to-orange-500"
      : "bg-gradient-to-r from-violet-600 to-fuchsia-500";

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <SmartToyIcon sx={{ fontSize: 18 }} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Uso de IA — este mes</h3>
            <p className="text-[11px] text-slate-500">
              Cap mensual {fmtUsd(stats.capUsd)} · {stats.hardStop ? "se pausa al llegar" : "sin pausa automática"}
            </p>
          </div>
        </div>
        {danger && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 border border-rose-200">
            <WarningAmberIcon sx={{ fontSize: 12 }} />
            Cap a punto de tocar
          </span>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold tabular-nums text-slate-900">
            {fmtUsd(stats.monthSpentUsd)}
          </span>
          <span className="text-xs text-slate-500">{pct}% del cap</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Hoy: {fmtUsd(stats.todaySpentUsd)} · {fmtInt(stats.todayCalls)} llamadas · Mes: {fmtInt(stats.monthCalls)} llamadas
        </p>
      </div>

      {/* Per-question cost — Marcos 2026-06-04: the "llamadas" number
          above is internal Claude API calls, NOT user-facing questions.
          One question fires ~5 internal calls (intent, search, reply,
          scoring). This row shows what one customer message actually
          costs us, averaged over the last 24h. Numerator is REAL spend
          only (dev/test stripped) so the figure isn't inflated by our
          iteration cycle. */}
      {stats.perQuestion && stats.perQuestion.questions > 0 && (
        <div className="rounded-xl border border-blue-200/70 bg-blue-50/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-100 text-blue-700">
                <BoltIcon sx={{ fontSize: 12 }} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                Costo por pregunta real
              </span>
            </div>
            <span className="text-sm font-bold tabular-nums text-blue-700">
              {fmtUsd(stats.perQuestion.costPerQuestionUsd)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-blue-800/80">
            Promedio de las últimas {stats.perQuestion.windowHours} h ·{" "}
            {fmtInt(stats.perQuestion.questions)} preguntas reales de clientes ·{" "}
            {fmtUsd(stats.perQuestion.spendUsd)} en spend real.
            {stats.perQuestion.spendUsdTest != null && stats.perQuestion.spendUsdTest > 0 && (
              <> Aparte {fmtUsd(stats.perQuestion.spendUsdTest)} se gastaron en pruebas/sandbox y NO están contados acá.</>
            )}
          </p>
        </div>
      )}

      {/* Real vs dev/test attribution — month-level split so the
          operator can see what fraction of the dashboard total is
          customer-driven vs internal iteration. */}
      {stats.attribution && (stats.attribution.monthRealUsd + stats.attribution.monthTestUsd) > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Origen del gasto del mes
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-500">Clientes reales</p>
              <p className="text-sm font-bold tabular-nums text-emerald-700">
                {fmtUsd(stats.attribution.monthRealUsd)}
              </p>
              <p className="text-[10px] text-slate-400">{fmtInt(stats.attribution.monthRealCalls)} llamadas</p>
            </div>
            <div>
              <p className="text-slate-500">Dev / pruebas</p>
              <p className="text-sm font-bold tabular-nums text-slate-600">
                {fmtUsd(stats.attribution.monthTestUsd)}
              </p>
              <p className="text-[10px] text-slate-400">{fmtInt(stats.attribution.monthTestCalls)} llamadas</p>
            </div>
          </div>
        </div>
      )}

      {/* Prompt-caching savings — only render when there's real cache
          traffic this month, otherwise the row reads as "0 saved, 0%"
          which doesn't help anyone. */}
      {stats.cache && (stats.cache.createTokens + stats.cache.readTokens) > 0 && (
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <BoltIcon sx={{ fontSize: 12 }} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                Ahorro por caching
              </span>
            </div>
            <span className="text-sm font-bold tabular-nums text-emerald-700">
              {fmtUsd(stats.cache.savedUsd)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-emerald-800/80">
            Hit ratio {Math.round(stats.cache.hitRatio * 100)}% ·{" "}
            {fmtInt(stats.cache.readTokens)} tokens leídos del caché ·{" "}
            sin caching habría costado {fmtUsd(stats.cache.baselineUsd)}
          </p>
        </div>
      )}

      {/* Marcos 2026-06-24: Bloque E visibility — cuántos turnos se
         saltearon Claude este mes gracias a los shortcuts (FAQ pre-IA,
         publication-FAQ, product-lookup, compresión de historial) y
         el USD estimado ahorrado al precio normal de input. */}
      {stats.costOpts && stats.costOpts.totalCount > 0 && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-100 text-amber-700">
                <BoltIcon sx={{ fontSize: 12 }} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                Ahorro por shortcuts (Bloque E)
              </span>
            </div>
            <span className="text-sm font-bold tabular-nums text-amber-700">
              {fmtUsd(stats.costOpts.totalUsdSaved)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-amber-800/80">
            {fmtInt(stats.costOpts.totalCount)} turnos esquivados a Claude ·{" "}
            {fmtInt(stats.costOpts.totalTokensSaved)} tokens estimados
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-amber-900">
            {stats.costOpts.bySource.map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-2">
                <span className="truncate">{COST_OPT_LABEL[s.source] ?? s.source}</span>
                <strong className="shrink-0 tabular-nums">{fmtInt(s.count)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.byCallSite.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Desglose por uso
          </p>
          <ul className="space-y-1.5">
            {stats.byCallSite.slice(0, 8).map((row) => (
              <li
                key={row.callSite}
                className="flex items-baseline justify-between gap-2 rounded-lg border border-slate-200/70 bg-slate-50/50 px-3 py-1.5"
              >
                <span className="truncate text-xs font-medium text-slate-700">
                  {CALL_SITE_LABEL[row.callSite] ?? row.callSite}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                  {fmtUsd(row.costUsd)} · {fmtInt(row.calls)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
