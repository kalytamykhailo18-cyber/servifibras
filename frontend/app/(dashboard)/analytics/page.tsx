"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsCard } from "@/components/analytics/metrics-card";
import { ConversationChart } from "@/components/analytics/conversation-chart";
import { ContactChart } from "@/components/analytics/contact-chart";
import { AIPerformanceChart } from "@/components/analytics/ai-performance-chart";
import { api } from "@/lib/api/endpoints";
import type { DashboardSummary } from "@/types";
import RefreshIcon from "@mui/icons-material/Refresh";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import PeopleIcon from "@mui/icons-material/People";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import BarChartIcon from "@mui/icons-material/BarChart";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import { toast } from "sonner";

const SECTION_LABEL = "mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.analytics.getDashboard();
      setAnalytics(data);
      toast.success("Analíticas actualizadas");
    } catch (err: any) {
      setError(err.message || "Error al cargar analíticas");
      toast.error("Error al cargar analíticas");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Analíticas</h1>
              <p className="text-sm text-muted-foreground">
                Dashboard de métricas y estadísticas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAnalytics}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97]"
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]">
            <BarChartIcon sx={{ fontSize: 22 }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Analíticas</h1>
            <p className="text-sm text-muted-foreground">
              Dashboard de métricas y estadísticas del sistema
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchAnalytics}
          disabled={isLoading}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          <RefreshIcon
            sx={{ fontSize: 16 }}
            className={isLoading ? "animate-spin" : ""}
          />
          Actualizar
        </button>
      </div>

      {/* SUMMARY METRICS — each with its own identity gradient */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

      {/* CONVERSATION METRICS */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          Métricas de Conversaciones
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
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

      {/* CONTACT & AI METRICS */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ContactChart metrics={contactMetrics} />
        <AIPerformanceChart metrics={aiPerformanceMetrics} />
      </div>

      {/* INSIGHTS */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
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

        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
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
