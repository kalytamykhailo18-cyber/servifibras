"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsCard } from "@/components/analytics/metrics-card";
import { ConversationChart } from "@/components/analytics/conversation-chart";
import { RoleMetricsCards } from "@/components/analytics/role-metrics-cards";
import { QualityPersonalCard } from "@/components/analytics/quality-personal-card";
import { QualityTeamOverlay } from "@/components/analytics/quality-team-overlay";
import { TeamPerformanceCard } from "@/components/analytics/team-performance-card";
import { ClaudeBudgetWidget } from "@/components/analytics/claude-budget-widget";
import { AiSavingsCard } from "@/components/analytics/ai-savings-card";
import { DailyDigestWidget } from "@/components/analytics/daily-digest-widget";
import { ContactChart } from "@/components/analytics/contact-chart";
import { AIPerformanceChart } from "@/components/analytics/ai-performance-chart";
import { MlAccountSplitCard } from "@/components/analytics/ml-account-split-card";
import { VentasUnificadasCard } from "@/components/analytics/ventas-unificadas-card";
import { DispatchStatsCard } from "@/components/analytics/dispatch-stats-card";
import { ReposicionByResponsibleCard } from "@/components/analytics/reposicion-by-responsible-card";
import { LostByCarrierCard } from "@/components/analytics/lost-by-carrier-card";
import { api } from "@/lib/api/endpoints";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import type { DashboardSummary } from "@/types";
import { UserRole } from "@/types";
import RefreshIcon from "@mui/icons-material/Refresh";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import PeopleIcon from "@mui/icons-material/People";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import BarChartIcon from "@mui/icons-material/BarChart";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import GradeIcon from "@mui/icons-material/Grade";
import GroupsIcon from "@mui/icons-material/Groups";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import { toast } from "sonner";

type AnalyticsTab =
  | "agentes"
  | "calidad-mia"
  | "calidad-equipo"
  | "ia"
  | "generales";

// Marcos 2026-06-17: ENCARGADO sees the same attention tabs an
// operator sees, PLUS the team-quality tab so they can supervise
// the team's score. NO Uso de IA / NO Métricas generales —
// those stay admin-only.
const TABS: Array<{ id: AnalyticsTab; label: string; icon: any; adminOnly: boolean; encargadoOk?: boolean }> = [
  { id: "agentes",         label: "Atención agentes", icon: SupportAgentIcon, adminOnly: false, encargadoOk: true },
  { id: "calidad-mia",     label: "Calidad tuya",     icon: GradeIcon,        adminOnly: false, encargadoOk: true },
  { id: "calidad-equipo",  label: "Calidad equipo",   icon: GroupsIcon,       adminOnly: true,  encargadoOk: true },
  { id: "ia",              label: "Uso de IA",        icon: SmartToyIcon,     adminOnly: true,  encargadoOk: false },
  { id: "generales",       label: "Métricas generales", icon: BarChartIcon,   adminOnly: true,  encargadoOk: false },
];

const SECTION_LABEL = "mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export default function AnalyticsPage() {
  const role = useAuthStore(selectUserRole);
  // System-wide aggregates (total platform contacts, AI performance,
  // insights, KB categories) are admin-only. Operators see their own
  // role-metrics card + their personal quality score and nothing else
  // that mixes scopes.
  const isAdmin = role === UserRole.ADMIN;
  const isEncargado = role === UserRole.ENCARGADO;
  // Marcos 2026-06-04 ask: lay the page out as top tabs (matching the
  // Conversaciones page) instead of a long scroll. Each tab gates its
  // own slice — admins see all five, non-admins see only the two that
  // make sense for them. Marcos 2026-06-17: ENCARGADO supervisors get
  // the attention tabs + team-quality but not Uso de IA / generales.
  const visibleTabs = TABS.filter((t) => {
    if (isAdmin) return true;
    if (isEncargado) return t.encargadoOk === true;
    return !t.adminOnly;
  });
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("agentes");
  // Snap back to a visible tab if the role gates the current one out
  // (e.g. demotion mid-session).
  useEffect(() => {
    if (!visibleTabs.find((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0]?.id ?? "agentes");
    }
  }, [visibleTabs, activeTab]);

  const [analytics, setAnalytics] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load — shows the page skeleton
  const loadAnalytics = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.analytics.getDashboard();
      setAnalytics(data);
    } catch (err: any) {
      setError(err.message || "Error al cargar analíticas");
      toast.error("Error al cargar analíticas");
    } finally {
      setIsLoading(false);
    }
  };

  // Silent refresh — used by the manual button and by realtime ticks. No
  // skeleton flash, no toast, just swap the data in place.
  const refreshAnalytics = async () => {
    try {
      const data = await api.analytics.getDashboard();
      setAnalytics(data);
    } catch (err: any) {
      // Silent — a single failed refresh shouldn't shout. The manual button
      // path (loadAnalytics) covers explicit user retries.
      console.warn("[analytics] silent refresh failed:", err?.message);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  // Real-time ticks come from the backend whenever something dashboard-
  // relevant happens (inbound messages, leads, transfers). Coalesce them so
  // a burst doesn't pile up overlapping fetches; keep the live indicator on
  // for ~2s after each tick so the user sees it pulse.
  const onTick = useCallback(() => {
    refreshAnalytics();
    setIsLive(true);
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setIsLive(false), 2000);
  }, []);
  useRealtimeEvent("metrics:tick", onTick);

  useEffect(() => {
    return () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <Skeleton className="h-10 w-28 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]">
              <BarChartIcon sx={{ fontSize: 22 }} />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Analíticas</h1>
              <p className="text-sm text-muted-foreground">
                Dashboard de métricas y estadísticas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadAnalytics}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97]"
          >
            <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
            Reintentar
          </button>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  const { conversationMetrics, contactMetrics, aiPerformanceMetrics, recentActivity, topCategories } = analytics;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)] sm:h-11 sm:w-11">
            <BarChartIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Analíticas</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              {isAdmin
                ? "Dashboard de métricas y estadísticas del sistema"
                : "Tu desempeño y conversaciones a cargo"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Live tick indicator — pulses every time a metrics:tick lands */}
          <span
            data-testid="analytics-live-indicator"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-200 ${
              isLive
                ? "border-emerald-200/70 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
            aria-live="polite"
          >
            <span className="relative flex h-1.5 w-1.5">
              {isLive && (
                <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-emerald-500 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  isLive ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
            </span>
            <span className="hidden sm:inline">{isLive ? "En vivo" : "Conectado"}</span>
          </span>

          <button
            type="button"
            onClick={refreshAnalytics}
            disabled={isLoading}
            aria-label="Actualizar"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:px-4"
          >
            <RefreshIcon
              sx={{ fontSize: 16 }}
              className={(isLoading ? "animate-spin " : "") + "text-blue-600"}
            />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {/* TABS — Marcos 2026-06-04: top-level tabs replace the long
          scroll. Same visual language as the Conversaciones page. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 overflow-x-auto" data-testid="analytics-tabs">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              data-testid={`analytics-tab-${t.id}`}
              aria-pressed={isActive}
              className={
                "inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors " +
                (isActive
                  ? "border-pink-600 text-pink-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
              }
            >
              <Icon sx={{ fontSize: 16 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "agentes" && (
        <div className="space-y-6">
          <RoleMetricsCards />
        </div>
      )}

      {activeTab === "calidad-mia" && (
        <div className="space-y-6">
          <QualityPersonalCard />
        </div>
      )}

      {activeTab === "calidad-equipo" && (isAdmin || isEncargado) && (
        <div className="space-y-6">
          <TeamPerformanceCard />
          <QualityTeamOverlay />
        </div>
      )}

      {activeTab === "ia" && isAdmin && (
        <div className="space-y-6">
          {/* Marcos 2026-06-05 (dispute settlement): savings snapshot
             arriba de todo porque es lo que valida el Bloque E. */}
          <AiSavingsCard />
          <ClaudeBudgetWidget />
          <DailyDigestWidget />
        </div>
      )}

      {activeTab === "generales" && isAdmin && (
        <div className="space-y-6">
      {/* SUMMARY METRICS — platform-wide aggregates. ADMIN-only because
          the underlying numbers (total contacts, AI performance %, KB
          categories) are system-wide, not role-scoped. Operators get
          their slice from the role-metrics card above. */}
      {isAdmin && (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
        <MetricsCard
          title="Total Conversaciones"
          value={conversationMetrics.total}
          description={`${conversationMetrics.active} activas`}
          icon={ChatBubbleOutlineIcon}
          gradient="from-blue-500 to-cyan-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]"
        />
        <MetricsCard
          title="Total Contactos"
          value={contactMetrics.total}
          description={`${contactMetrics.newThisMonth} nuevos este mes`}
          icon={PeopleIcon}
          gradient="from-emerald-500 to-teal-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]"
        />
        <MetricsCard
          title="Conversaciones con IA"
          value={aiPerformanceMetrics.conversationsWithAI}
          description={`${aiPerformanceMetrics.conversationsFullyAutomated} totalmente automatizadas`}
          icon={SmartToyIcon}
          gradient="from-violet-500 to-purple-500"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(139_92_246/0.45)]"
        />
        <MetricsCard
          title="Mensajes Totales"
          value={conversationMetrics.totalMessages}
          description={`${aiPerformanceMetrics.totalAIMessages} de IA`}
          icon={ChatBubbleOutlineIcon}
          gradient="from-indigo-500 to-violet-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(99_102_241/0.45)]"
        />
        <MetricsCard
          title="Performance IA"
          value={`${aiPerformanceMetrics.aiResponseRate}%`}
          description="Tasa de respuesta automática"
          icon={AttachMoneyIcon}
          gradient="from-pink-500 to-rose-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]"
        />
        <MetricsCard
          title="Actividad 24h"
          value={recentActivity.conversationsLast24h}
          description={`${recentActivity.messagesLast24h} mensajes`}
          icon={TrendingUpIcon}
          gradient="from-orange-500 to-red-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(249_115_22/0.45)]"
        />
      </div>
      )}

      {/* CONVERSATION METRICS — admin-only. These are platform-wide
          aggregates of every conversation, so operators with role-scoped
          inboxes shouldn't see them mixed with their own. */}
      {isAdmin && (
      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          Métricas de Conversaciones
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          <MetricsCard
            title="Conversaciones Activas"
            value={conversationMetrics.active}
            icon={ChatBubbleOutlineIcon}
            gradient="from-emerald-500 to-teal-400"
            glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]"
          />
          <MetricsCard
            title="Mensajes por Conversación"
            value={conversationMetrics.avgMessagesPerConversation.toFixed(1)}
            icon={ChatBubbleOutlineIcon}
            gradient="from-blue-500 to-cyan-400"
            glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]"
          />
          <MetricsCard
            title="Conversaciones Cerradas"
            value={conversationMetrics.closed}
            icon={PeopleIcon}
            gradient="from-slate-600 to-slate-400"
            glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(100_116_139/0.45)]"
          />
        </div>

        <ConversationChart metrics={conversationMetrics} />
      </section>
      )}

      {/* CONTACT & AI METRICS — admin-only (platform-wide). */}
      {isAdmin && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ContactChart metrics={contactMetrics} />
        <AIPerformanceChart metrics={aiPerformanceMetrics} />
      </div>
      )}

      {/* Bloque B items 1 + 4 — multi-cuenta + unified sales (admin). */}
      {isAdmin && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <VentasUnificadasCard />
          <MlAccountSplitCard />
        </div>
      )}

      {/* Marcos 2026-06-12: dispatch history grouped by mensajería.
          Full-width card because the carrier list expands with order
          drilldowns and benefits from horizontal room. */}
      {isAdmin && (
        <DispatchStatsCard />
      )}

      {/* Marcos 2026-06-22: costo de reposiciones por responsable —
         "se contabiliza en dinero el valor del error segmentado por
         semana, mes, personalizado". ADMIN-only. Marcos 2026-06-23:
         + card hermana "A cobrar a mensajerías" para el monto de los
         paquetes perdidos por courier. */}
      {isAdmin && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <ReposicionByResponsibleCard />
          <LostByCarrierCard />
        </div>
      )}

      {/* INSIGHTS — admin-only (contact + KB counts are global). */}
      {isAdmin && (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <h3 className={SECTION_LABEL}>Insights de Contactos</h3>
          <div className="space-y-2">
            <InsightRow
              label="Nuevos hoy"
              value={contactMetrics.newToday}
              tint="bg-blue-50 border-blue-200/70"
              dot="bg-blue-500"
              accent="text-blue-700"
            />
            <InsightRow
              label="Nuevos esta semana"
              value={contactMetrics.newThisWeek}
              tint="bg-violet-50 border-violet-200/70"
              dot="bg-violet-500"
              accent="text-violet-700"
            />
            <InsightRow
              label="Con conversaciones activas"
              value={contactMetrics.withActiveConversations}
              tint="bg-emerald-50 border-emerald-200/70"
              dot="bg-emerald-500"
              accent="text-emerald-700"
            />
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <h3 className={SECTION_LABEL}>Categorías de Conocimiento</h3>
          {topCategories.length === 0 ? (
            <p className="text-sm italic text-slate-400">Sin datos de categorías</p>
          ) : (
            <div className="space-y-2">
              {topCategories.slice(0, 5).map((cat, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-purple-500 text-[11px] font-bold text-white shadow-[0_2px_8px_-2px_rgb(139_92_246/0.45)]">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-900">
                      {cat.category}
                    </span>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-violet-700">
                    {cat.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
        </div>
      )}
    </div>
  );
}

function InsightRow({
  label,
  value,
  tint,
  dot,
  accent,
}: {
  label: string;
  value: number;
  tint: string;
  dot: string;
  accent: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${tint}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <span className={`text-base font-bold tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}
