"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import type { ContactMetrics } from "@/types";
import { CHANNEL_LABELS } from "@/types";

interface ContactChartProps {
  metrics: ContactMetrics;
}

const CHART_COLORS = ["#10b981", "#3b82f6", "#ec4899", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#64748b"];

export function ContactChart({ metrics }: ContactChartProps) {
  const channelData = Object.entries(metrics.byChannel || {}).map(([channel, count]) => ({
    name: CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] || channel,
    value: count,
  }));

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900">Contactos por Canal</h3>
        <p className="text-xs text-slate-500">Distribución de contactos entre canales</p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={channelData}
            cx="50%"
            cy="45%"
            labelLine={false}
            // In-slice percent label only — outer labels were overflowing the
            // chart bounds on narrow viewports. Channel names live in the
            // legend below.
            label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
            outerRadius="70%"
            dataKey="value"
          >
            {channelData.map((entry, index) => (
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
          <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
