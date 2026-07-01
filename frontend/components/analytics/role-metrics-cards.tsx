"use client";

// Three per-role widgets for the dashboard. Each one is independently
// gated and only fetches when the current user has access. ADMIN sees all.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api/endpoints";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole, CHANNEL_LABELS } from "@/types";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import InventoryIcon from "@mui/icons-material/Inventory";
import StoreIcon from "@mui/icons-material/Store";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Compact label for the stale-quote threshold and per-row idle time.
//   < 60 min  → "25 min"
//   < 24 h    → "1.5 h"
//   else      → "2 d"
function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) {
    return hours === Math.floor(hours)
      ? `${hours} h`
      : `${(Math.round(hours * 10) / 10)} h`;
  }
  return `${Math.round(hours / 24)} d`;
}

function deltaPill(deltaPct: number) {
  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  const cls = flat
    ? "bg-slate-50 text-slate-600 border-slate-200"
    : up
    ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
    : "bg-rose-50 text-rose-700 border-rose-200/70";
  const sign = up ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {sign}
      {deltaPct}%
    </span>
  );
}

// Marcos 2026-06-29: chip row con los agentes activos de cada rol.
// Antes los cards tenían el nombre del agente hardcodeado (Brenda /
// Franco / Aldo) — cuando Marcos sumaba un agente nuevo con su email
// la métrica seguía mostrando el viejo. Ahora pull dinámico de
// /admin/users + chips por rol. Métrica per-user (filtrar por
// assignedTo del user) sigue como follow-up (requiere refactor del
// backend role-metrics).
function AgentChips({
  role,
  selectedUserId,
  onSelect,
  statsByUserId,
}: {
  role: UserRole;
  selectedUserId: string | null;
  onSelect: (userId: string | null) => void;
  // Marcos 2026-06-30: opcional stat por usuario para subscript
  // del chip (ej. "Aldo · 12"). Cuando hay valor lo renderiza al
  // costado del nombre; sin valor el chip queda en su forma simple.
  statsByUserId?: Map<string, number>;
}) {
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }> | null>(null);
  useEffect(() => {
    const acceptedRoles = new Set<string>([role as string, UserRole.ENCARGADO as string]);
    api.users
      .list({ activeOnly: true })
      .then((rows) => setUsers(
        (rows ?? [])
          .filter((u: any) => acceptedRoles.has(u.role))
          .map((u: any) => ({ id: u.id, name: u.name, email: u.email }))
      ))
      .catch(() => setUsers([]));
  }, [role]);
  if (!users || users.length === 0) return null;
  // Marcos 2026-06-29: chips clickables — seleccionar uno narrowea la
  // card al agente puntual. "Todos" vuelve al agregado de rol.
  const todosActive = selectedUserId === null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        {users.length === 1 ? 'Agente' : `${users.length} agentes`}
      </span>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition ${
          todosActive
            ? 'border-slate-900 bg-slate-900 text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        Todos
      </button>
      {users.map((u) => {
        const active = selectedUserId === u.id;
        const stat = statsByUserId?.get(u.id);
        return (
          <button
            key={u.id}
            type="button"
            onClick={() => onSelect(active ? null : u.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition ${
              active
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
            }`}
            title={stat != null ? `${u.email} · ${stat} armados hoy` : u.email}
          >
            <span>{u.name}</span>
            {stat != null && stat > 0 && (
              <span className={`tabular-nums text-[10px] ${active ? 'text-white/80' : 'text-slate-500'}`}>
                · {stat}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Atención ----------

function AtencionCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getAtencionMetrics>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Marcos 2026-06-29: selected agent narrowing.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Marcos 2026-06-30: per-agent activity subscript. Same pattern as
  // LogisticaCard — un fetch al mount, mapa userId → repliesToday.
  const [perAgent, setPerAgent] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    api.analytics.getAtencionPerAgentToday()
      .then((rows) => setPerAgent(new Map(rows.map((r) => [r.userId, r.repliesToday]))))
      .catch(() => setPerAgent(new Map()));
  }, []);
  useEffect(() => {
    setData(null);
    setError(null);
    api.analytics.getAtencionMetrics(selectedUserId ? { userId: selectedUserId } : undefined)
      .then(setData)
      .catch((e) => setError(e?.message || "error"));
  }, [selectedUserId]);

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[0_4px_12px_-2px_rgb(59_130_246/0.45)]">
          <SupportAgentIcon sx={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Atención</h3>
          <p className="text-[11px] text-slate-500">Cola, latencia, conversaciones sin resolver</p>
          <AgentChips role={UserRole.ATENCION} selectedUserId={selectedUserId} onSelect={setSelectedUserId} statsByUserId={perAgent} />
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200/70 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {!data && !error && <div className="text-xs text-slate-500">Cargando...</div>}

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded-xl border p-3 ${data.queueWaitingOverThreshold > 0 ? "border-rose-200/70 bg-rose-50/50" : "border-slate-200/70 bg-slate-50/50"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <HourglassBottomIcon sx={{ fontSize: 12 }} />
                +{data.alertThresholdMin}m esperando
              </div>
              <div className={`mt-0.5 text-2xl font-bold tabular-nums ${data.queueWaitingOverThreshold > 0 ? "text-rose-700" : "text-slate-900"}`}>
                {data.queueWaitingOverThreshold}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <TimerOutlinedIcon sx={{ fontSize: 12 }} />
                1ª respuesta (7d)
              </div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
                {formatDuration(data.avgFirstResponseSeconds)}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Sin resolver ({data.unresolvedByAI.length})
            </p>
            {data.unresolvedByAI.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-500">
                Nada pendiente — buen trabajo.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.unresolvedByAI.slice(0, 6).map((c) => (
                  <li key={c.conversationId}>
                    <Link
                      href={`/conversations/${c.conversationId}`}
                      className="block rounded-xl border border-slate-200/70 bg-white px-3 py-2 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium text-slate-900">
                          {c.contactName || "Sin nombre"}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-rose-700">
                          {c.waitingMinutes}m
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-slate-500">
                        {CHANNEL_LABELS[c.channel as keyof typeof CHANNEL_LABELS] ?? c.channel} · {c.lastMessage || "—"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Franco (VENTAS) ----------

function VentasCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getVentasMetrics>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [perAgent, setPerAgent] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    api.analytics.getVentasPerAgentToday()
      .then((rows) => setPerAgent(new Map(rows.map((r) => [r.userId, r.leadsToday]))))
      .catch(() => setPerAgent(new Map()));
  }, []);
  useEffect(() => {
    setData(null);
    setError(null);
    api.analytics.getVentasMetrics(selectedUserId ? { userId: selectedUserId } : undefined)
      .then(setData)
      .catch((e) => setError(e?.message || "error"));
  }, [selectedUserId]);

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-red-400 text-white shadow-[0_4px_12px_-2px_rgb(249_115_22/0.45)]">
          <TrendingUpIcon sx={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Ventas</h3>
          <p className="text-[11px] text-slate-500">Mayoristas, presupuestos y conversión</p>
          <AgentChips role={UserRole.VENTAS} selectedUserId={selectedUserId} onSelect={setSelectedUserId} statsByUserId={perAgent} />
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200/70 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {!data && !error && <div className="text-xs text-slate-500">Cargando...</div>}

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="text-[11px] font-medium text-slate-500">Hoy</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-orange-700">
                {data.mayoristasToday}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="text-[11px] font-medium text-slate-500">7 días</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-orange-700">
                {data.mayoristasWeek}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <ShowChartIcon sx={{ fontSize: 12 }} />
                Conv. 30d
              </div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-700">
                {Math.round(data.conversionRate30d * 100)}%
              </div>
              <div className="text-[10px] text-slate-500">
                {data.conversionRate30dDetail.won}W · {data.conversionRate30dDetail.lost}L · {data.conversionRate30dDetail.openQuoted}abiertos
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Cotizaciones sin respuesta +{formatMinutes(data.quoteFollowupMinutes)} ({data.quotesWaitingOverThreshold.length})
            </p>
            {data.quotesWaitingOverThreshold.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-500">
                Todo al día.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.quotesWaitingOverThreshold.slice(0, 6).map((q) => (
                  <li key={q.leadId}>
                    <Link
                      href={`/leads/${q.leadId}`}
                      className="block rounded-xl border border-slate-200/70 bg-white px-3 py-2 transition-colors hover:border-orange-300 hover:bg-orange-50/40"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium text-slate-900">
                          {q.contactName || "Sin nombre"}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-orange-700">
                          {formatMinutes(q.idleMinutes)}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-slate-500">
                        {q.productInterest || "—"}
                        {q.estimatedValue ? ` · USD ${q.estimatedValue}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Logística ----------

function LogisticaCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getLogisticaMetrics>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Marcos 2026-06-30: per-agent armado-today para los chips.
  // Independiente del fetch principal (no depende de selectedUserId).
  const [perAgent, setPerAgent] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    api.analytics.getLogisticaPerAgentToday()
      .then((rows) => setPerAgent(new Map(rows.map((r) => [r.userId, r.armadosToday]))))
      .catch(() => setPerAgent(new Map()));
  }, []);
  useEffect(() => {
    setData(null);
    setError(null);
    api.analytics.getLogisticaMetrics(selectedUserId ? { userId: selectedUserId } : undefined)
      .then(setData)
      .catch((e) => setError(e?.message || "error"));
  }, [selectedUserId]);

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 text-white shadow-[0_4px_12px_-2px_rgb(20_184_166/0.45)]">
          <LocalShippingIcon sx={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Logística</h3>
          <p className="text-[11px] text-slate-500">Pedidos por despachar, atrasos y stock bajo</p>
          <AgentChips role={UserRole.LOGISTICA} selectedUserId={selectedUserId} onSelect={setSelectedUserId} statsByUserId={perAgent} />
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200/70 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {!data && !error && <div className="text-xs text-slate-500">Cargando...</div>}

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="text-[11px] font-medium text-slate-500">Pendientes</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-teal-700">
                {data.pendingOrders}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <WarningAmberIcon sx={{ fontSize: 12 }} />
                Atrasados (+{data.overdueThresholdHours}h)
              </div>
              <div className={"mt-0.5 text-2xl font-bold tabular-nums " + (data.overdueOrders > 0 ? "text-rose-700" : "text-slate-700")}>
                {data.overdueOrders}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <InventoryIcon sx={{ fontSize: 12 }} />
                Stock bajo
              </div>
              <div className={"mt-0.5 text-2xl font-bold tabular-nums " + (data.lowStockProducts > 0 ? "text-amber-700" : "text-slate-700")}>
                {data.lowStockProducts}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="text-[11px] font-medium text-slate-500">Conv. asignadas</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
                {data.conversationsAssigned}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="text-[11px] font-medium text-slate-500">Despachados (7d)</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-700">
                {data.dispatchedRecent}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Pedidos a despachar ({data.pendingTop.length})
            </p>
            {data.pendingTop.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-500">
                Sin pedidos pendientes.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.pendingTop.slice(0, 6).map((o) => (
                  <li key={o.orderId}>
                    <Link
                      href={`/orders/${o.orderId}`}
                      className="block rounded-xl border border-slate-200/70 bg-white px-3 py-2 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium text-slate-900">
                          {o.contactName || o.orderNumber}
                        </span>
                        <span className={"shrink-0 text-[10px] tabular-nums " + (o.ageHours >= data.overdueThresholdHours ? "text-rose-700" : "text-teal-700")}>
                          {o.ageHours}h
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-slate-500">
                        {o.orderNumber} · {o.currency} {o.amount.toFixed(2)} · {o.status}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Admin ----------

function AdminCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getAdminRoleMetrics>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.analytics.getAdminRoleMetrics()
      .then(setData)
      .catch((e) => setError(e?.message || "error"));
  }, []);

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-slate-700 to-zinc-500 text-white shadow-[0_4px_12px_-2px_rgb(100_116_139/0.45)]">
          <ShowChartIcon sx={{ fontSize: 18 }} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Administración</h3>
          <p className="text-[11px] text-slate-500">Comparativa W/W, canal de mejor conversión, productos</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200/70 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {!data && !error && <div className="text-xs text-slate-500">Cargando...</div>}

      {data && (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Semana vs anterior
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(["conversations", "leads", "orders"] as const).map((k) => (
                <div key={k} className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
                  <div className="text-[11px] font-medium text-slate-500 capitalize">{k}</div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-xl font-bold tabular-nums text-slate-900">
                      {data.wow[k].thisWeek}
                    </span>
                    {deltaPill(data.wow[k].deltaPct)}
                  </div>
                  <div className="text-[10px] text-slate-500">prev: {data.wow[k].lastWeek}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <StoreIcon sx={{ fontSize: 12 }} />
                Mejor conversión (canal)
              </div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900">
                {data.bestConvertingChannel.channel
                  ? CHANNEL_LABELS[data.bestConvertingChannel.channel as keyof typeof CHANNEL_LABELS] ?? data.bestConvertingChannel.channel
                  : "—"}
              </div>
              <div className="text-[10px] text-slate-500 tabular-nums">
                {data.bestConvertingChannel.won}/{data.bestConvertingChannel.total} · {Math.round(data.bestConvertingChannel.rate * 100)}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <InventoryIcon sx={{ fontSize: 12 }} />
                Costo Claude / conv
              </div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900">
                {data.claudeCostPerConversation.costUsd != null
                  ? `USD ${data.claudeCostPerConversation.costUsd.toFixed(4)}`
                  : "—"}
              </div>
              <div className="text-[10px] italic text-slate-500">
                {data.claudeCostPerConversation.reason}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Top productos vendidos (30d)
            </p>
            {data.topSoldProducts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2 text-xs text-slate-500">
                Sin pedidos registrados.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.topSoldProducts.map((p) => (
                  <li key={p.name} className="flex items-baseline justify-between gap-2 rounded-xl border border-slate-200/70 bg-white px-3 py-2">
                    <span className="truncate text-xs font-medium text-slate-900">{p.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                      {p.quantity} u · {p.orderCount} pedidos
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RoleMetricsCards() {
  const role = useAuthStore(selectUserRole);
  if (!role) return null;
  // ADMIN sees all four; each scoped role sees its own card.
  const showAtencion  = role === UserRole.ADMIN || role === UserRole.ATENCION;
  const showVentas    = role === UserRole.ADMIN || role === UserRole.VENTAS;
  const showLogistica = role === UserRole.ADMIN || role === UserRole.LOGISTICA;
  const showAdmin     = role === UserRole.ADMIN;

  const cards = [showAtencion, showVentas, showLogistica, showAdmin].filter(Boolean).length;
  if (cards === 0) return null;

  // 1-card view stays full width. 2/3 → match column count. 4 (admin)
  // wraps to 2-by-2 on lg+ so the cards stay readable.
  const gridCols =
    cards === 1 ? "" :
    cards === 2 ? "lg:grid-cols-2" :
    cards === 3 ? "lg:grid-cols-3" :
    "lg:grid-cols-2 xl:grid-cols-4";

  return (
    <div className={`grid grid-cols-1 gap-4 ${gridCols}`}>
      {showAtencion && <AtencionCard />}
      {showVentas && <VentasCard />}
      {showLogistica && <LogisticaCard />}
      {showAdmin && <AdminCard />}
    </div>
  );
}
