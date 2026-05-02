import { OrderStatus } from "@/types";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckIcon from "@mui/icons-material/Check";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import InventoryIcon from "@mui/icons-material/Inventory";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import { safeFormatDate } from "@/lib/date";

interface OrderTimelineProps {
  currentStatus: OrderStatus;
  dispatchedAt?: Date | null;
  deliveredAt?: Date | null;
  createdAt: Date;
}

export function OrderTimeline({
  currentStatus,
  dispatchedAt,
  deliveredAt,
  createdAt,
}: OrderTimelineProps) {
  const timeline = [
    {
      status: OrderStatus.CONFIRMED,
      label: "Confirmado",
      icon: CheckIcon,
      gradient: "from-blue-500 to-cyan-400",
      glow: "rgb(59 130 246 / 0.45)",
      date: createdAt,
    },
    {
      status: OrderStatus.PROCESSING,
      label: "En Preparación",
      icon: HourglassEmptyIcon,
      gradient: "from-amber-500 to-orange-400",
      glow: "rgb(245 158 11 / 0.45)",
      date: null,
    },
    {
      status: OrderStatus.DISPATCHED,
      label: "Despachado",
      icon: LocalShippingIcon,
      gradient: "from-violet-500 to-purple-500",
      glow: "rgb(139 92 246 / 0.45)",
      date: dispatchedAt,
    },
    {
      status: OrderStatus.DELIVERED,
      label: "Entregado",
      icon: InventoryIcon,
      gradient: "from-emerald-500 to-teal-400",
      glow: "rgb(16 185 129 / 0.45)",
      date: deliveredAt,
    },
  ] as const;

  const getStatusIndex = (status: OrderStatus) => {
    const order = [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.DISPATCHED,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
    ];
    return order.indexOf(status);
  };

  const currentIndex = getStatusIndex(currentStatus);
  const isCancelled = currentStatus === OrderStatus.CANCELLED;

  return (
    <div>
      {timeline.map((item, index) => {
        const itemIndex = getStatusIndex(item.status);
        const isCompleted = itemIndex <= currentIndex && !isCancelled;
        const isCurrent = item.status === currentStatus && !isCancelled;
        const Icon = item.icon;

        return (
          <div key={item.status} className="flex gap-3">
            {/* Timeline rail */}
            <div className="flex flex-col items-center">
              <div className="flex-shrink-0">
                {isCompleted ? (
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br ${item.gradient} text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]`}
                    style={{ boxShadow: `0 6px 16px -4px ${item.glow}` }}
                  >
                    <Icon sx={{ fontSize: 16 }} />
                  </span>
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-dashed border-slate-200 bg-white text-slate-300">
                    <Icon sx={{ fontSize: 16 }} />
                  </span>
                )}
              </div>
              {index < timeline.length - 1 && (
                <div
                  className={`mt-1 mb-1 w-0.5 flex-1 ${
                    isCompleted
                      ? "bg-gradient-to-b from-emerald-400 to-emerald-200"
                      : "bg-slate-200"
                  }`}
                  style={{ minHeight: "32px" }}
                />
              )}
            </div>

            {/* Content */}
            <div className={`flex-1 ${index < timeline.length - 1 ? "pb-6" : "pb-0"}`}>
              <div className="flex items-center gap-2">
                <p
                  className={`text-sm font-semibold ${
                    isCurrent
                      ? "text-blue-700"
                      : isCompleted
                      ? "text-slate-900"
                      : "text-slate-400"
                  }`}
                >
                  {item.label}
                </p>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-blue-500 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                    </span>
                    Actual
                  </span>
                )}
              </div>
              {item.date && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {safeFormatDate(item.date, "PPp")}
                </p>
              )}
              {isCurrent && !item.date && (
                <p className="mt-0.5 text-xs text-blue-600">En este momento</p>
              )}
            </div>
          </div>
        );
      })}

      {isCancelled && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-red-200/70 bg-red-50/60 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_6px_16px_-4px_rgb(239_68_68/0.45)]">
            <CancelIcon sx={{ fontSize: 16 }} />
          </span>
          <div>
            <p className="text-sm font-semibold text-red-900">Cancelado</p>
            <p className="text-xs text-red-700">Pedido cancelado</p>
          </div>
        </div>
      )}
    </div>
  );
}
