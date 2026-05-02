"use client";

import type { AIPerformanceMetrics } from "@/types";
import SmartToyIcon from "@mui/icons-material/SmartToy";

interface AIPerformanceChartProps {
  metrics: AIPerformanceMetrics;
}

export function AIPerformanceChart({ metrics }: AIPerformanceChartProps) {
  const automationRate = metrics.conversationsWithAI > 0
    ? (metrics.conversationsFullyAutomated / metrics.conversationsWithAI) * 100
    : 0;

  const totalMessages = metrics.totalAIMessages + metrics.totalHumanMessages;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(139_92_246/0.45)]">
          <SmartToyIcon sx={{ fontSize: 18 }} />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-900">Rendimiento de la IA</h3>
          <p className="text-xs text-slate-500">Métricas de performance del asistente</p>
        </div>
      </div>

      {/* Hero stat */}
      <div className="mb-5 rounded-xl border border-violet-200/70 bg-gradient-to-br from-violet-50 to-purple-50/50 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">
          Total Mensajes de IA
        </p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums text-violet-900">
          {metrics.totalAIMessages || 0}
        </p>
      </div>

      {/* Progress stats */}
      <div className="space-y-4">
        <ProgressStat
          label="Tasa de Respuesta IA"
          value={metrics.aiResponseRate}
          gradient="from-emerald-500 to-teal-400"
          accent="text-emerald-700"
          subtitle={`${metrics.totalAIMessages} de ${totalMessages} mensajes totales`}
        />

        <ProgressStat
          label="Tasa de Automatización"
          value={automationRate}
          gradient="from-blue-500 to-cyan-400"
          accent="text-blue-700"
          subtitle="Sin intervención humana"
        />
      </div>

      {/* Mini grid */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        <MiniStat
          label="Con IA"
          value={metrics.conversationsWithAI}
          dot="bg-violet-500"
        />
        <MiniStat
          label="Promedio"
          value={metrics.averageAIMessagesPerConversation.toFixed(1)}
          dot="bg-blue-500"
        />
        <MiniStat
          label="Humanos"
          value={metrics.totalHumanMessages}
          dot="bg-slate-400"
        />
      </div>
    </div>
  );
}

function ProgressStat({
  label,
  value,
  gradient,
  accent,
  subtitle,
}: {
  label: string;
  value: number;
  gradient: string;
  accent: string;
  subtitle: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${accent}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  dot,
}: {
  label: string;
  value: number | string;
  dot: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-2.5 text-center">
      <div className="flex items-center justify-center gap-1">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          {label}
        </p>
      </div>
      <p className="mt-1 text-base font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
