import { Badge } from "@/components/ui/badge";
import { OrderStatus, ORDER_STATUS_LABELS } from "@/types";

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.CONFIRMED:
        return "bg-blue-100 text-blue-800";
      case OrderStatus.PROCESSING:
        return "bg-yellow-100 text-yellow-800";
      case OrderStatus.DISPATCHED:
        return "bg-purple-100 text-purple-800";
      case OrderStatus.DELIVERED:
        return "bg-green-100 text-green-800";
      case OrderStatus.CANCELLED:
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Badge className={getStatusColor(status)}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}
