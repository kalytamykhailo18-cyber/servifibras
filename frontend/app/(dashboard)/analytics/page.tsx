"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MetricsCard } from "@/components/analytics/metrics-card";
import { ConversationChart } from "@/components/analytics/conversation-chart";
import { ContactChart } from "@/components/analytics/contact-chart";
import { AIPerformanceChart } from "@/components/analytics/ai-performance-chart";
import { api } from "@/lib/api/endpoints";
import type { DashboardSummary } from "@/types";
import RefreshIcon from '@mui/icons-material/Refresh';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import PeopleIcon from '@mui/icons-material/People';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import InventoryIcon from '@mui/icons-material/Inventory';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { toast } from "sonner";

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ========================================================================
  // FETCH ANALYTICS
  // ========================================================================

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

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>

        <Skeleton className="h-96" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: ERROR STATE
  // ========================================================================

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Analíticas</h1>
            <p className="text-muted-foreground">
              Dashboard de métricas y estadísticas
            </p>
          </div>
          <Button onClick={fetchAnalytics} variant="outline" size="sm">
            <RefreshIcon className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>

        <Alert variant="destructive">
          <ErrorOutlineIcon className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  const { conversationMetrics, contactMetrics, aiPerformanceMetrics, recentActivity, topCategories } = analytics;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analíticas</h1>
          <p className="text-muted-foreground">
            Dashboard de métricas y estadísticas del sistema
          </p>
        </div>

        <Button onClick={fetchAnalytics} variant="outline" size="sm">
          <RefreshIcon className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* SUMMARY METRICS */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricsCard
          title="Total Conversaciones"
          value={conversationMetrics.total}
          description={`${conversationMetrics.active} activas`}
          icon={ChatBubbleOutlineIcon}
        />

        <MetricsCard
          title="Total Contactos"
          value={contactMetrics.total}
          description={`${contactMetrics.newThisMonth} nuevos este mes`}
          icon={PeopleIcon}
        />

        <MetricsCard
          title="Conversaciones con IA"
          value={aiPerformanceMetrics.conversationsWithAI}
          description={`${aiPerformanceMetrics.conversationsFullyAutomated} totalmente automatizadas`}
          icon={SmartToyIcon}
        />

        <MetricsCard
          title="Mensajes Totales"
          value={conversationMetrics.totalMessages}
          description={`${aiPerformanceMetrics.totalAIMessages} de IA`}
          icon={ChatBubbleOutlineIcon}
        />

        <MetricsCard
          title="Performance IA"
          value={`${aiPerformanceMetrics.aiResponseRate}%`}
          description="Tasa de respuesta automática"
          icon={AttachMoneyIcon}
        />

        <MetricsCard
          title="Actividad 24h"
          value={recentActivity.conversationsLast24h}
          description={`${recentActivity.messagesLast24h} mensajes`}
          icon={TrendingUpIcon}
        />
      </div>

      {/* CONVERSATION METRICS */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Métricas de Conversaciones</h2>
        <div className="grid gap-4 md:grid-cols-3 mb-4">
          <MetricsCard
            title="Conversaciones Activas"
            value={conversationMetrics.active}
            icon={ChatBubbleOutlineIcon}
          />

          <MetricsCard
            title="Mensajes por Conversación"
            value={conversationMetrics.avgMessagesPerConversation.toFixed(1)}
            icon={ChatBubbleOutlineIcon}
          />

          <MetricsCard
            title="Conversaciones Cerradas"
            value={conversationMetrics.closed}
            icon={PeopleIcon}
          />
        </div>

        <ConversationChart metrics={conversationMetrics} />
      </div>

      {/* CONTACT & AI METRICS */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ContactChart metrics={contactMetrics} />
        <AIPerformanceChart metrics={aiPerformanceMetrics} />
      </div>

      {/* ADDITIONAL INSIGHTS */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-6 border rounded-lg">
          <h3 className="font-semibold mb-4">Insights de Contactos</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Nuevos hoy</span>
              <span className="font-medium">{contactMetrics.newToday}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Nuevos esta semana</span>
              <span className="font-medium">{contactMetrics.newThisWeek}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Con conversaciones activas</span>
              <span className="font-medium">{contactMetrics.withActiveConversations}</span>
            </div>
          </div>
        </div>

        <div className="p-6 border rounded-lg">
          <h3 className="font-semibold mb-4">Categorías de Conocimiento</h3>
          <div className="space-y-3">
            {topCategories.slice(0, 5).map((cat, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{cat.category}</span>
                <span className="font-medium">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
