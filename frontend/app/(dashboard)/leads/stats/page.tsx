"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricsCard } from "@/components/analytics/metrics-card";
import { api } from "@/lib/api/endpoints";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CancelIcon from '@mui/icons-material/Cancel';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { CHANNEL_LABELS, LEAD_STATUS_LABELS, type LeadPipelineStats } from "@/types";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#A28BFE", "#FF6B9D"];

export default function LeadsStatsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<LeadPipelineStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  // Prepare data for charts
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
      {/* HEADER */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/leads")}>
          <ArrowBackIcon className="h-4 w-4 mr-2" />
          Volver al Pipeline
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Estadísticas del Pipeline</h1>
        <p className="text-muted-foreground">
          Métricas y análisis de oportunidades de venta
        </p>
      </div>

      {/* SUMMARY METRICS */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricsCard
          title="Total Oportunidades"
          value={stats.totalLeads}
          description="En el pipeline"
          icon={TrendingUpIcon}
        />

        <MetricsCard
          title="Tasa de Conversión"
          value={`${stats.conversionRate.toFixed(1)}%`}
          description="Oportunidades ganadas"
          icon={GpsFixedIcon}
        />

        <MetricsCard
          title="Valor Ganado"
          value={`$${(stats.totalWonValue || 0).toLocaleString("es-AR")}`}
          description="USD cerrados"
          icon={EmojiEventsIcon}
        />

        <MetricsCard
          title="Tamaño Promedio"
          value={`$${(stats.averageDealSize || stats.avgDealSize).toLocaleString("es-AR")}`}
          description="USD por deal"
          icon={AttachMoneyIcon}
        />
      </div>

      {/* ADDITIONAL METRICS */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Valor Total Estimado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">
              ${(stats.totalEstimatedValue || 0).toLocaleString("es-AR")} USD
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Potencial del pipeline
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Valor Ganado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              ${(stats.totalWonValue || 0).toLocaleString("es-AR")} USD
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Oportunidades cerradas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Valor Perdido</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">
              ${(stats.totalLostValue || 0).toLocaleString("es-AR")} USD
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Oportunidades perdidas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* CHARTS */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Distribución por Estado</CardTitle>
            <CardDescription>Oportunidades en cada etapa del pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Source Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Oportunidades por Canal</CardTitle>
            <CardDescription>Distribución por fuente de origen</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sourceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="oportunidades" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Products */}
      <Card>
        <CardHeader>
          <CardTitle>Productos Más Solicitados</CardTitle>
          <CardDescription>Top productos de interés en las oportunidades</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.topProducts.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No hay datos de productos
            </p>
          ) : (
            <div className="space-y-3">
              {stats.topProducts.map((product, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                      {index + 1}
                    </div>
                    <span className="font-medium">{product.product}</span>
                  </div>
                  <Badge variant="secondary">{product.count} oportunidades</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Badge({ children, variant }: { children: React.ReactNode; variant?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
      variant === "secondary" ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground"
    }`}>
      {children}
    </span>
  );
}
