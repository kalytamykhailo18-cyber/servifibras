"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ConversationMetrics } from "@/types";

interface ConversationChartProps {
  metrics: ConversationMetrics;
}

export function ConversationChart({ metrics }: ConversationChartProps) {
  const statusData = [
    { name: "Activas", value: metrics.active || 0 },
    { name: "Esperando", value: metrics.waiting || 0 },
    { name: "Cerradas", value: metrics.closed || 0 },
  ];

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900">Estado de Conversaciones</h3>
        <p className="text-xs text-slate-500">Distribución por estado</p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={statusData}>
          <defs>
            <linearGradient id="barBlueCyan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7} />
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
          <Bar dataKey="value" fill="url(#barBlueCyan)" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
