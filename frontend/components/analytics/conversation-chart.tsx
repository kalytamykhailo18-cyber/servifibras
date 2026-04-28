"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ConversationMetrics } from "@/types";
import { CHANNEL_LABELS } from "@/types";

interface ConversationChartProps {
  metrics: ConversationMetrics;
}

export function ConversationChart({ metrics }: ConversationChartProps) {
  // Prepare data for status distribution
  const statusData = [
    { name: "Activas", value: metrics.active || 0 },
    { name: "Cerradas", value: metrics.closed || 0 },
    { name: "Esperando", value: metrics.waiting || 0 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estado de Conversaciones</CardTitle>
        <CardDescription>Distribución por estado</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={statusData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
