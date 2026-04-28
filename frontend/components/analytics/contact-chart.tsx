"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import type { ContactMetrics } from "@/types";
import { CHANNEL_LABELS } from "@/types";

interface ContactChartProps {
  metrics: ContactMetrics;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#A28BFE"];

export function ContactChart({ metrics }: ContactChartProps) {
  // Prepare data for contact channels
  const channelData = Object.entries(metrics.byChannel || {}).map(([channel, count]) => ({
    name: CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] || channel,
    value: count,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contactos por Canal</CardTitle>
        <CardDescription>Distribución de contactos entre canales</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={channelData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {channelData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
