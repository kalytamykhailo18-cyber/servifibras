"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsCard } from "@/components/analytics/metrics-card";
import { api } from "@/lib/api/endpoints";
import { formatNumber } from "@/lib/format";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { CHANNEL_LABELS, LEAD_STATUS_LABELS, UserRole, type LeadPipelineStats } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";

const LEADS_ROLES = [UserRole.ADMIN, UserRole.VENTAS];

const CHART_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#f97316", "#10b981", "#94a3b8"];

const SECTION_LABEL = "mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export default function LeadsStatsPage() {
  const router = useRouter();
  const { isAllowed } = useRoleGuard(LEADS_ROLES);
  const [stats, setStats] = useState<LeadPipelineStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAllowed) return;
    const fetchStats = async () => {
      try {
        setIsLoading(true);
        const data = await api.leads.getStats();
        setStats(data);
      } catch (error: any) {
        toast.error(error.message || "Error al cargar estadísticas");
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [isAllowed]);

  if (!isAllowed) return null;

  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-36 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const statusData = Object.entries(stats.byStatus || {}).map(([status, count]) => ({
    name: LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] || status,
    value: count,
  }));

  const sourceData = Object.entries(stats.bySource).map(([source, count]) => ({
    name: CHANNEL_LABELS[source as keyof typeof CHANNEL_LABELS] || source,
    oportunidades: count,
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP BAR */}
      <button
        type="button"
        onClick={() => router.push("/leads")}
        className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
      >
        <ArrowBackIcon
          sx={{ fontSize: 16 }}
          className="transition-transform duration-300 group-hover:-translate-x-0.5"
        />
        Volver al Pipeline
      </button>

      {/* PAGE HEADER */}
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]">
          <TrendingUpIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">
            Estadísticas del Pipeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Métricas y análisis de oportunidades de venta
          </p>
        </div>
      </div>

      {/* SUMMARY METRICS */}
      <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
        <MetricsCard
          title="Total Oportunidades"
          value={stats.totalLeads}
          description="En el pipeline"
          icon={TrendingUpIcon}
          gradient="from-orange-500 to-red-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(249_115_22/0.45)]"
        />
        <MetricsCard
          title="Tasa de Conversión"
          value={`${stats.conversionRate.toFixed(1)}%`}
          description="Oportunidades ganadas"
          icon={GpsFixedIcon}
          gradient="from-pink-500 to-rose-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]"
        />
        <MetricsCard
          title="Valor Ganado"
          value={`$${formatNumber(stats.totalWonValue)}`}
          description="USD cerrados"
          icon={EmojiEventsIcon}
          gradient="from-emerald-500 to-teal-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]"
        />
        <MetricsCard
          title="Tamaño Promedio"
          value={`$${formatNumber(stats.averageDealSize || stats.avgDealSize)}`}
          description="USD por deal"
          icon={AttachMoneyIcon}
          gradient="from-blue-500 to-cyan-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]"
        />
      </div>

      {/* VALUE BREAKDOWN */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        <ValueCard
          label="Valor Total Estimado"
          amount={stats.totalEstimatedValue}
          subtitle="Potencial del pipeline"
          tint="bg-blue-50 border-blue-200/70"
          accent="text-blue-700"
          dot="bg-blue-500"
        />
        <ValueCard
          label="Valor Ganado"
          amount={stats.totalWonValue}
          subtitle="Oportunidades cerradas"
          tint="bg-emerald-50 border-emerald-200/70"
          accent="text-emerald-700"
          dot="bg-emerald-500"
        />
        <ValueCard
          label="Valor Perdido"
          amount={stats.totalLostValue}
          subtitle="Oportunidades perdidas"
          tint="bg-red-50 border-red-200/70"
          accent="text-red-700"
          dot="bg-red-500"
        />
      </div>

      {/* CHARTS */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900">Distribución por Estado</h3>
            <p className="text-xs text-slate-500">Oportunidades en cada etapa del pipeline</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                outerRadius={90}
                dataKey="value"
              >
                {statusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid rgb(226 232 240 / 0.7)",
                  boxShadow: "0 12px 28px -8px rgb(15 23 42 / 0.18)",
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900">Oportunidades por Canal</h3>
            <p className="text-xs text-slate-500">Distribución por fuente de origen</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sourceData}>
              <defs>
                <linearGradient id="barOrange" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={1} />
                  <stop offset="100%" stopColor="#fb923c" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid rgb(226 232 240 / 0.7)",
                  boxShadow: "0 12px 28px -8px rgb(15 23 42 / 0.18)",
                }}
              />
              <Bar dataKey="oportunidades" fill="url(#barOrange)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TOP PRODUCTS */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Productos Más Solicitados</h3>
          <p className="text-xs text-slate-500">Top productos de interés en las oportunidades</p>
        </div>
        {stats.topProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
            <p className="text-sm text-slate-500">No hay datos de productos</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stats.topProducts.map((product, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 transition-colors duration-150 hover:border-orange-200 hover:bg-orange-50/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-red-400 text-xs font-bold text-white shadow-[0_4px_10px_-2px_rgb(249_115_22/0.45)]">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-slate-900">{product.product}</span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                  <span className="font-semibold text-slate-900 tabular-nums">{product.count}</span>
                  oportunidades
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ValueCard({
  label,
  amount,
  subtitle,
  tint,
  accent,
  dot,
}: {
  label: string;
  amount: number | undefined;
  subtitle: string;
  tint: string;
  accent: string;
  dot: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${tint}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
          {label}
        </p>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>${formatNumber(amount || 0)} USD</p>
      <p className="mt-1 text-[11px] text-slate-600">{subtitle}</p>
    </div>
  );
}
