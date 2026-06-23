import { OrderStatus } from '@prisma/client';

export { OrderStatus };

export interface OrderListFilter {
  status?: OrderStatus;
  contactId?: string;
  conversationId?: string;
  orderNumber?: string;
  // Marcos 2026-06-18: free-text search on /orders. Hits orderNumber
  // (contains) OR contact.name (contains), insensitive. Replaces the
  // need to scroll the table when the operator only remembers a name
  // or a number fragment.
  search?: string;
  limit?: number;
  offset?: number;
}

export interface OrderDetails {
  id: string;
  orderNumber: string;
  conversationId: string | null;
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    type: string;
  };
  amount: number;
  currency: string;
  products: any;
  status: OrderStatus;
  trackingNumber: string | null;
  carrier: string | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderData {
  contactId: string;
  conversationId?: string | null;
  orderNumber?: string;
  amount: number;
  currency?: string;
  products: any;
  notes?: string;
  // Marcos 2026-06-12: operator pre-selects which section of the
  // daily logística panel should receive this row. One of
  // MOTOS / MICROS / RETIRA_CASEROS / LAMINADOS_PRFV.
  sectionOverride?: string | null;
  // Marcos 2026-06-17: reposición flag — re-shipment after armado
  // error. Stays out of pending-invoicing + sales metrics. When
  // true the form forces the operator to pick carrier+zone and
  // the shipping cost auto-fills from the tariff table.
  isReposicion?: boolean;
  carrier?: string | null;
  shippingZone?: string | null;
  shippingCost?: number | null;
  // Marcos 2026-06-18: stamped from the controller's req.user.id.
  createdById?: string | null;
  // Marcos 2026-06-18: 'SALE' (default) / 'REPOSICION' / 'DEVOLUCION'.
  // The string takes precedence over the legacy isReposicion bool.
  orderType?: 'SALE' | 'REPOSICION' | 'DEVOLUCION';
  // Marcos 2026-06-22: responsable del paquete mal despachado
  // (catalogo OperationalResponsible). Solo aplica a REPOSICION; el
  // form valida que esté presente en ese tab.
  responsibleId?: string | null;
  // Marcos 2026-06-23: campos del "destino del producto" agregados
  // a REPOSICION (toggle CON/SIN devolución). Todos opcionales.
  //   withReturn=true  → returnState=PENDING + opcional return courier
  //   withReturn=false → returnState=NONE; productValue (si se carga)
  //                       suma al panel del responsable como costo
  withReturn?: boolean;
  productValue?: number | null;
  productLabel?: string | null;
  returnCarrier?: string | null;
  returnShippingCost?: number | null;
  // Marcos 2026-06-23: descuento general % aplicado al pedido (lista
  // de precios con descuento por transferencia, etc). El backend lo
  // persiste por auditoría; el `amount` ya viene calculado con el
  // descuento aplicado por el form. Per-row discount vive en cada
  // entry de products[] como `discountPercent`.
  discountPercent?: number | null;
}

export interface UpdateOrderData {
  amount?: number;
  currency?: string;
  products?: any;
  notes?: string;
  responsibleId?: string | null;
}

/**
 * Marcos 2026-06-21: input para la cancelacion de pedido. Razon
 * obligatoria (min 5 chars) para que quede registro de POR QUE se
 * canceló — el panel se rehúsa a aceptar reasons vacios.
 */
export interface CancelOrderData {
  reason: string;
  userId: string | null;
}

export interface UpdateTrackingData {
  trackingNumber: string;
  carrier: string;
}

export interface OrderStatistics {
  totalOrders: number;
  byStatus: Record<OrderStatus, number>;
  totalRevenue: number;
  averageOrderValue: number;
  revenueByMonth: Array<{ month: string; revenue: number }>;
  topProducts: Array<{ product: string; quantity: number; revenue: number }>;
  fulfillmentMetrics: {
    pending: number;
    dispatched: number;
    delivered: number;
    cancelled: number;
    averageFulfillmentTime: number; // in days
  };
}

export interface IOrderManagementService {
  listOrders(filter: OrderListFilter): Promise<{
    data: OrderDetails[];
    total: number;
    limit: number;
    offset: number;
  }>;

  getOrderById(orderId: string): Promise<OrderDetails | null>;

  createOrder(data: CreateOrderData): Promise<OrderDetails>;

  updateOrder(orderId: string, data: UpdateOrderData): Promise<OrderDetails | null>;

  deleteOrder(orderId: string): Promise<boolean>;

  updateOrderStatus(orderId: string, status: OrderStatus): Promise<boolean>;

  updateTrackingInfo(
    orderId: string,
    trackingData: UpdateTrackingData,
  ): Promise<boolean>;

  getOrderStatistics(): Promise<OrderStatistics>;
}
