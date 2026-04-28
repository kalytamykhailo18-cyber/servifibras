"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/endpoints";
import type { DashboardSummary } from "@/types";
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import InventoryIcon from '@mui/icons-material/Inventory';
import PeopleIcon from '@mui/icons-material/People';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

// ============================================================================
// DASHBOARD HOME PAGE
// ============================================================================

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ========================================================================
  // FETCH DASHBOARD SUMMARY
  // ========================================================================

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setIsLoading(true);
        const data = await api.analytics.getSummary();
        setSummary(data);
      } catch (err: any) {
        setError(err.message || "Error al cargar datos");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSummary();
  }, []);

  // ========================================================================
  // LOADING STATE
  // ========================================================================

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ========================================================================
  // ERROR STATE
  // ========================================================================

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Bienvenido al panel de administración de Servifibras
          </p>
        </div>

        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ========================================================================
  // STATS CARDS DATA
  // ========================================================================

  const statsCards = [
    {
      title: "Conversaciones",
      value: summary?.totalConversations || 0,
      description: `${summary?.activeConversations || 0} activas`,
      icon: ChatBubbleOutlineIcon,
      color: "text-blue-600",
      bgColor: "bg-blue-50 dark:bg-blue-950",
    },
    {
      title: "Contactos",
      value: summary?.totalContacts || 0,
      description: "Total en base de datos",
      icon: PeopleIcon,
      color: "text-green-600",
      bgColor: "bg-green-50 dark:bg-green-950",
    },
    {
      title: "Oportunidades",
      value: summary?.totalLeads || 0,
      description: "Pipeline de ventas",
      icon: TrendingUpIcon,
      color: "text-purple-600",
      bgColor: "bg-purple-50 dark:bg-purple-950",
    },
    {
      title: "Pedidos",
      value: summary?.totalOrders || 0,
      description: "Total procesados",
      icon: InventoryIcon,
      color: "text-orange-600",
      bgColor: "bg-orange-50 dark:bg-orange-950",
    },
    {
      title: "Ingresos del Mes",
      value: `$${summary?.revenueThisMonth?.toLocaleString("es-AR") || 0}`,
      description: "USD facturados",
      icon: AttachMoneyIcon,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950",
    },
    {
      title: "Estado del Sistema",
      value: "Operativo",
      description: "Todos los servicios activos",
      icon: ShowChartIcon,
      color: "text-teal-600",
      bgColor: "bg-teal-50 dark:bg-teal-950",
    },
  ];

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Bienvenido al panel de administración de Servifibras
        </p>
      </div>

      {/* STATS CARDS */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {statsCards.map((card, index) => {
          const Icon = card.icon;

          return (
            <Card
              key={index}
              className="transition-all hover:shadow-lg hover:scale-[1.02] duration-200"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {card.title}
                </CardTitle>
                <div className={`${card.bgColor} p-2 rounded-lg`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {card.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* QUICK ACTIONS */}
      <Card>
        <CardHeader>
          <CardTitle>Acciones Rápidas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline" className="cursor-pointer hover:bg-accent">
            Ver Conversaciones Activas
          </Badge>
          <Badge variant="outline" className="cursor-pointer hover:bg-accent">
            Crear Nuevo Contacto
          </Badge>
          <Badge variant="outline" className="cursor-pointer hover:bg-accent">
            Ver Pipeline de Ventas
          </Badge>
          <Badge variant="outline" className="cursor-pointer hover:bg-accent">
            Revisar Pedidos Pendientes
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
