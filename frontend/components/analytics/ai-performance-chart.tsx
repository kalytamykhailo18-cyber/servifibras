"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AIPerformanceMetrics } from "@/types";

interface AIPerformanceChartProps {
  metrics: AIPerformanceMetrics;
}

export function AIPerformanceChart({ metrics }: AIPerformanceChartProps) {
  const automationRate = metrics.conversationsWithAI > 0
    ? ((metrics.conversationsFullyAutomated / metrics.conversationsWithAI) * 100).toFixed(1)
    : "0";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rendimiento de la IA</CardTitle>
        <CardDescription>Métricas de performance del asistente virtual</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Total AI Messages */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Total Mensajes de IA</span>
            <span className="text-2xl font-bold">{metrics.totalAIMessages || 0}</span>
          </div>
        </div>

        {/* AI Response Rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Tasa de Respuesta IA</span>
            <span className="text-sm font-bold text-green-600">{metrics.aiResponseRate}%</span>
          </div>
          <Progress value={metrics.aiResponseRate} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            {metrics.totalAIMessages} mensajes de IA de {metrics.totalAIMessages + metrics.totalHumanMessages} totales
          </p>
        </div>

        {/* Conversations with AI */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Conversaciones con IA</span>
            <span className="text-sm font-bold">{metrics.conversationsWithAI}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {metrics.conversationsFullyAutomated} totalmente automatizadas
          </p>
        </div>

        {/* Automation Rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Tasa de Automatización</span>
            <span className="text-sm font-bold text-blue-600">{automationRate}%</span>
          </div>
          <Progress value={parseFloat(automationRate)} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            Sin intervención humana
          </p>
        </div>

        {/* Average AI Messages */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Promedio de Mensajes IA</span>
            <span className="text-sm font-bold">{metrics.averageAIMessagesPerConversation.toFixed(1)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Por conversación con IA
          </p>
        </div>

        {/* Human Messages */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Mensajes Humanos</span>
            <span className="text-sm font-bold">{metrics.totalHumanMessages}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
