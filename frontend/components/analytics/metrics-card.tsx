"use client";

import { SvgIconComponent } from "@mui/icons-material";

interface MetricsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: SvgIconComponent;
  /** Tailwind gradient classes — eg "from-blue-500 to-cyan-400". Defaults to blue/cyan. */
  gradient?: string;
  /** Tailwind class for the soft halo shadow — eg "shadow-[0_8px_20px_-6px_rgb(59_130_246/0.45)]". */
  glow?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export function MetricsCard({
  title,
  value,
  description,
  icon: Icon,
  gradient = "from-blue-500 to-cyan-400",
  glow = "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]",
  trend,
}: MetricsCardProps) {
  return (
    <div className="group rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-8px_rgb(15_23_42/0.12)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </p>
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105 ${gradient} ${glow}`}
        >
          <Icon sx={{ fontSize: 18 }} />
        </span>
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums text-slate-900">
        {value}
      </p>
      {description && (
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      )}
      {trend && (
        <div className="mt-3 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              trend.isPositive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%
          </span>
          <span className="text-[11px] text-slate-500">vs mes anterior</span>
        </div>
      )}
    </div>
  );
}
