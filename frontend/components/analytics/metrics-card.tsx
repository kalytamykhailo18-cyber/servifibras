"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SvgIconComponent } from "@mui/icons-material";

interface MetricsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: SvgIconComponent;
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
  trend,
}: MetricsCardProps) {
  return (
    <Card className="transition-all hover:shadow-lg hover:scale-[1.02] duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            <span
              className={`text-xs font-medium ${
                trend.isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {trend.isPositive ? "+" : ""}
              {trend.value}%
            </span>
            <span className="text-xs text-muted-foreground">vs mes anterior</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
