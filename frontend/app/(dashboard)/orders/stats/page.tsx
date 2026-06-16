"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricsCard } from "@/components/analytics/metrics-card";
import { api } from "@/lib/api/endpoints";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import BarChartIcon from "@mui/icons-material/BarChart";
import InventoryIcon from "@mui/icons-material/Inventory";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { toast } from "sonner";
import {
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import { ORDER_STATUS_LABELS, UserRole, type OrderFulfillmentStats } from "@/types";
import { formatNumber } from "@/lib/format";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";

const ORDERS_ROLES = [UserRole.ADMIN, UserRole.LOGISTICA];

const CHART_COLORS = ["#3b82f6", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444"];

export default function OrdersStatsPage() {
  const router = useRouter();
  const { isAllowed } = useRoleGuard(ORDERS_ROLES);
  const [stats, setStats] = useState<OrderFulfillmentStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAllowed) return;
    const fetchStats = async () => {
      try {
        setIsLoading(true);
        const data = await api.orders.getStats();
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const statusData = Object.entries(stats.byStatus || {}).map(([status, count]) => ({
    name: ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status,
    value: count,
  }));

  const revenueData = stats.revenueByMonth.map((item) => ({
    month: item.month,
    revenue: item.revenue,
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP BAR */}
      <button
        type="button"
        onClick={() => router.push("/orders")}
        className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
      >
        <ArrowBackIcon
          sx={{ fontSize: 16 }}
          className="transition-transform duration-300 group-hover:-translate-x-0.5"
        />
        Volver a Pedidos
      </button>

      {/* PAGE HEADER */}
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]">
          <BarChartIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">
            Estadísticas de Pedidos
          </h1>
          <p className="text-sm text-muted-foreground">
            Métricas de ventas y cumplimiento de pedidos
          </p>
        </div>
      </div>

      {/* SUMMARY METRICS */}
      <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
        <MetricsCard
          title="Total Pedidos"
          value={stats.totalOrders}
          description="Todos los estados"
          icon={InventoryIcon}
          gradient="from-green-500 to-emerald-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(34_197_94/0.45)]"
        />
        <MetricsCard
          title="Ingresos Totales"
          value={`$${formatNumber(stats.totalRevenue)}`}
          description="USD facturados"
          icon={AttachMoneyIcon}
          gradient="from-emerald-500 to-teal-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]"
        />
        <MetricsCard
          title="Valor Promedio"
          value={`$${formatNumber(stats.averageOrderValue || stats.avgOrderValue)}`}
          description="USD por pedido"
          icon={TrendingUpIcon}
          gradient="from-blue-500 to-cyan-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]"
        />
        <MetricsCard
          title="Tasa de Cumplimiento"
          value={`${(stats.fulfillmentRate || 0).toFixed(1)}%`}
          description="Pedidos entregados"
          icon={AccessTimeIcon}
          gradient="from-pink-500 to-rose-400"
          glow="shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(236_72_153/0.45)]"
        />
      </div>

      {/* FULFILLMENT BREAKDOWN */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <BreakdownCard
          label="En Proceso"
          count={stats.processingOrders || 0}
          subtitle="Procesando"
          tint="bg-amber-50 border-amber-200/70"
          accent="text-amber-700"
          dot="bg-amber-500"
        />
        <BreakdownCard
          label="Despachados"
          count={stats.dispatchedOrders || 0}
          subtitle="En camino"
          tint="bg-violet-50 border-violet-200/70"
          accent="text-violet-700"
          dot="bg-violet-500"
        />
        <BreakdownCard
          label="Entregados"
          count={stats.deliveredOrders || 0}
          subtitle="Completados"
          tint="bg-emerald-50 border-emerald-200/70"
          accent="text-emerald-700"
          dot="bg-emerald-500"
        />
        <BreakdownCard
          label="Cancelados"
          count={stats.cancelledOrders || 0}
          subtitle="No completados"
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
            <p className="text-xs text-slate-500">Pedidos en cada etapa</p>
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
            <h3 className="text-base font-semibold text-slate-900">Ingresos Mensuales</h3>
            <p className="text-xs text-slate-500">Evolución de ingresos en el tiempo</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={revenueData}>
              <defs>
                <linearGradient id="lineEmerald" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip
                formatter={(value) => `$${formatNumber(value as number)}`}
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid rgb(226 232 240 / 0.7)",
                  boxShadow: "0 12px 28px -8px rgb(15 23 42 / 0.18)",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="url(#lineEmerald)"
                strokeWidth={3}
                dot={{ fill: "#10b981", r: 4 }}
                activeDot={{ r: 6 }}
                name="Ingresos (USD)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TOP PRODUCTS */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Productos Más Vendidos</h3>
          <p className="text-xs text-slate-500">Top productos por cantidad y revenue</p>
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
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white p-3 transition-colors duration-150 hover:border-emerald-200 hover:bg-emerald-50/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-400 text-sm font-bold text-white shadow-[0_4px_10px_-2px_rgb(34_197_94/0.45)]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {product.product}
                    </p>
                    <p className="text-xs text-slate-500">
                      <span className="font-medium tabular-nums text-slate-700">{product.quantity}</span>{" "}
                      unidades
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-sm font-bold tabular-nums text-emerald-700">
                    ${formatNumber(product.revenue)}
                  </span>
                  <p className="mt-0.5 text-[10px] text-slate-500">USD</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BreakdownCard({
  label,
  count,
  subtitle,
  tint,
  accent,
  dot,
}: {
  label: string;
  count: number;
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
      <p className={`text-2xl font-bold tabular-nums ${accent}`}>{count}</p>
      <p className="mt-1 text-[11px] text-slate-600">{subtitle}</p>
    </div>
  );
}
