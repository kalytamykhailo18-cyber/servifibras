import { OrderStatus, ORDER_STATUS_LABELS } from "@/types";

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

const STATUS_TINT: Record<string, { dot: string; pill: string }> = {
  [OrderStatus.CONFIRMED]:  { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  [OrderStatus.PROCESSING]: { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200/70" },
  [OrderStatus.DISPATCHED]: { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
  [OrderStatus.DELIVERED]:  { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  [OrderStatus.CANCELLED]:  { dot: "bg-red-500",     pill: "bg-red-50 text-red-700 border-red-200/70" },
};
const fallback = { dot: "bg-slate-400", pill: "bg-slate-50 text-slate-600 border-slate-200" };

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const tint = STATUS_TINT[status] ?? fallback;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tint.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tint.dot}`} />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
