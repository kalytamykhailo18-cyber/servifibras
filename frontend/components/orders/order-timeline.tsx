import { OrderStatus, ORDER_STATUS_LABELS } from "@/types";
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import { format } from "date-fns";
import { es } from "date-fns/locale";

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
      date: createdAt,
    },
    {
      status: OrderStatus.PROCESSING,
      label: "En Preparación",
      date: null,
    },
    {
      status: OrderStatus.DISPATCHED,
      label: "Despachado",
      date: dispatchedAt,
    },
    {
      status: OrderStatus.DELIVERED,
      label: "Entregado",
      date: deliveredAt,
    },
  ];

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
    <div className="space-y-4">
      {timeline.map((item, index) => {
        const itemIndex = getStatusIndex(item.status);
        const isCompleted = itemIndex <= currentIndex && !isCancelled;
        const isCurrent = item.status === currentStatus && !isCancelled;

        return (
          <div key={item.status} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="flex-shrink-0">
                {isCompleted ? (
                  <CheckCircleIcon className="h-6 w-6 text-green-600" />
                ) : isCurrent ? (
                  <CircleOutlinedIcon className="h-6 w-6 text-blue-600 fill-blue-100" />
                ) : (
                  <CircleOutlinedIcon className="h-6 w-6 text-gray-300" />
                )}
              </div>
              {index < timeline.length - 1 && (
                <div
                  className={`w-0.5 h-12 ${
                    isCompleted ? "bg-green-600" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
            <div className="flex-1 pb-8">
              <p
                className={`font-medium ${
                  isCurrent ? "text-blue-600" : isCompleted ? "" : "text-gray-400"
                }`}
              >
                {item.label}
              </p>
              {item.date && (
                <p className="text-sm text-muted-foreground">
                  {format(new Date(item.date), "PPp", { locale: es })}
                </p>
              )}
              {isCurrent && !item.date && (
                <p className="text-sm text-blue-600">Estado actual</p>
              )}
            </div>
          </div>
        );
      })}

      {isCancelled && (
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <CancelIcon className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <p className="font-medium text-red-600">Cancelado</p>
            <p className="text-sm text-muted-foreground">Pedido cancelado</p>
          </div>
        </div>
      )}
    </div>
  );
}
