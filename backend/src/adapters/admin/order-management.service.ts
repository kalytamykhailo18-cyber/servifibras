import { Injectable } from '@nestjs/common';
import { PrismaClient, OrderStatus } from '@prisma/client';
import {
  IOrderManagementService,
  OrderListFilter,
  OrderDetails,
  CreateOrderData,
  UpdateOrderData,
  UpdateTrackingData,
  OrderStatistics,
} from '../../use-cases/admin/order-management.interface';
import { ContactDimensionsService } from '../lead-detection/contact-dimensions.service';
import { OrderNotificationService } from './order-notification.service';

@Injectable()
export class OrderManagementService implements IOrderManagementService {
  private prisma: PrismaClient;

  constructor(
    private readonly contactDimensions: ContactDimensionsService,
    private readonly orderNotifications: OrderNotificationService,
  ) {
    this.prisma = new PrismaClient();
  }

  private generateOrderNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `ORD-${year}-${random}`;
  }

  async listOrders(filter: OrderListFilter): Promise<{
    data: OrderDetails[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { status, contactId, conversationId, orderNumber, limit = 20, offset = 0 } = filter;

    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;
    if (conversationId) where.conversationId = conversationId;
    if (orderNumber) where.orderNumber = { contains: orderNumber };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              type: true,
            },
          },
          // Marcos 2026-06-18: surface the operator who loaded the
          // pedido so the UI can render "Cargado por …".
          createdBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders as OrderDetails[],
      total,
      limit,
      offset,
    };
  }

  async getOrderById(orderId: string): Promise<OrderDetails | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
          },
        },
      },
    });

    return order as OrderDetails | null;
  }

  async createOrder(data: CreateOrderData): Promise<OrderDetails> {
    // Operator can pass an explicit order number (matching their paper or
    // ERP system); fall back to a generated one. Uniqueness is enforced
    // at the schema level — duplicates surface as P2002 to the caller.
    const orderNumber = (data.orderNumber && data.orderNumber.trim().length > 0)
      ? data.orderNumber.trim()
      : this.generateOrderNumber();

    // Marcos 2026-06-12: sanitise the section override against the
    // panel's known section list so a typo doesn't end up as an
    // orphan row. Anything else falls through as null and the
    // carrier-regex inference takes over.
    const VALID_SECTIONS = new Set(['MOTOS', 'MICROS', 'RETIRA_CASEROS', 'LAMINADOS_PRFV']);
    const sectionOverride =
      typeof data.sectionOverride === 'string' && VALID_SECTIONS.has(data.sectionOverride)
        ? data.sectionOverride
        : null;
    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        contactId: data.contactId,
        conversationId: data.conversationId ?? null,
        amount: data.amount,
        currency: data.currency || 'USD',
        products: data.products,
        notes: data.notes,
        sectionOverride,
        status: OrderStatus.CONFIRMED,
        // Marcos 2026-06-17: reposición flag — kept for backward
        // compat (queries that filter by it). Marcos 2026-06-18:
        // promoted to OrderType enum (SALE / REPOSICION /
        // DEVOLUCION); we sync isReposicion=true when type is
        // REPOSICION so the existing isReposicion=false filters
        // still exclude both reposiciones and devoluciones.
        ...(() => {
          const raw = String((data as any).orderType ?? '').toUpperCase();
          const orderType = raw === 'REPOSICION' || raw === 'DEVOLUCION' || raw === 'SALE'
            ? (raw as 'SALE' | 'REPOSICION' | 'DEVOLUCION')
            : ((data as any).isReposicion ? 'REPOSICION' : 'SALE');
          return {
            orderType,
            isReposicion: orderType === 'REPOSICION',
          };
        })(),
        carrier: (data as any).carrier ?? null,
        shippingZone: (data as any).shippingZone ?? null,
        shippingCost: typeof (data as any).shippingCost === 'number' ? (data as any).shippingCost : null,
        // Marcos 2026-06-18: operator audit for team-performance
        // analytics. createOrder may be called by an authenticated
        // controller (with the user id) or by the TN sync service
        // (no user — falls back to null).
        createdById: typeof (data as any).createdById === 'string' ? (data as any).createdById : null,
      },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
          },
        },
      },
    });

    // Reflect on the contact's funnel-stage — first order → COMPRADOR,
    // 2nd+ → FRECUENTE. Non-blocking; errors don't break order creation.
    void this.contactDimensions.onOrderCreated(data.contactId);

    // If this is a wholesale-tier customer, alert Aldo in real-time with
    // the full product detail. Same fire-and-forget pattern.
    void this.orderNotifications.notifyIfWholesale(order.id);

    return order as OrderDetails;
  }

  async updateOrder(
    orderId: string,
    data: UpdateOrderData,
  ): Promise<OrderDetails | null> {
    const order = await this.prisma.order.update({
      where: { id: orderId },
      data,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
          },
        },
      },
    });

    return order as OrderDetails | null;
  }

  async deleteOrder(orderId: string): Promise<boolean> {
    await this.prisma.order.delete({
      where: { id: orderId },
    });
    return true;
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
  ): Promise<boolean> {
    const updateData: any = { status };

    // Set timestamps based on status
    if (status === OrderStatus.DISPATCHED) {
      updateData.dispatchedAt = new Date();
    } else if (status === OrderStatus.DELIVERED) {
      updateData.deliveredAt = new Date();
      // Ensure dispatched timestamp exists
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
      });
      if (order && !order.dispatchedAt) {
        updateData.dispatchedAt = new Date();
      }
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    return true;
  }

  async updateTrackingInfo(
    orderId: string,
    trackingData: UpdateTrackingData,
  ): Promise<boolean> {
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber: trackingData.trackingNumber,
        carrier: trackingData.carrier,
      },
    });

    return true;
  }

  /**
   * Marcos 2026-06-12: list orders that have been armed but not
   * yet invoiced. Newest first. Manual + TN are both included
   * because Marcos invoices both; ML stays out because that one
   * goes through Mercado Libre's invoice flow on their side.
   */
  async listPendingInvoicing(): Promise<Array<{
    id: string;
    orderNumber: string;
    contact: { id: string; name: string | null };
    amount: number;
    currency: string;
    sectionOverride: string | null;
    carrier: string | null;
    createdAt: Date;
    notes: string | null;
  }>> {
    const rows = await this.prisma.order.findMany({
      where: {
        invoicedAt: null,
        source: { in: ['MANUAL', 'TIENDANUBE'] as any },
        status: { notIn: ['CANCELLED'] as any },
        // Marcos 2026-06-17/06-18: only SALE rows go through the
        // invoicing queue — reposiciones (Servifibras pays courier)
        // and devoluciones (return-tracking only) are operational
        // movements without a buyer to bill.
        orderType: 'SALE',
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        orderNumber: true,
        amount: true,
        currency: true,
        sectionOverride: true,
        carrier: true,
        createdAt: true,
        notes: true,
        contact: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.orderNumber,
      contact: { id: r.contact.id, name: r.contact.name },
      amount: r.amount,
      currency: r.currency,
      sectionOverride: r.sectionOverride,
      carrier: r.carrier,
      createdAt: r.createdAt,
      notes: r.notes,
    }));
  }

  /**
   * Marcos 2026-06-12: tick / un-tick an order as invoiced.
   * Returns null when the id doesn't exist so the controller can
   * 404 cleanly.
   */
  async markInvoiced(
    orderId: string,
    invoiced: boolean,
    userId: string | null,
  ): Promise<{ id: string; orderNumber: string; invoicedAt: Date | null; invoicedById: string | null } | null> {
    try {
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          invoicedAt: invoiced ? new Date() : null,
          invoicedById: invoiced ? userId : null,
        },
        select: { id: true, orderNumber: true, invoicedAt: true, invoicedById: true },
      });
      return updated;
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  /**
   * Marcos 2026-06-15: render an order as a printable PDF with the
   * delivery block (CUIT/DNI, calle + número, localidad, CP, zona,
   * mensajería, costo de envío). Fields are pulled from the contact's
   * metadata (set on quick-create or via the contact-edit panel);
   * shipping fields fall back to the order's shipping* columns.
   */
  async renderPdf(orderId: string): Promise<Buffer | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        contact: {
          select: {
            id: true, name: true, phone: true, email: true, metadata: true,
          },
        },
      },
    });
    if (!order) return null;
    const meta = ((order.contact?.metadata ?? null) as any) || {};
    const fiscalId = (meta.fiscalId ?? meta.cuit ?? meta.dni ?? null) as string | null;
    const SECTION_LABELS: Record<string, string> = {
      MOTOS: 'Motos',
      MICROS: 'Micros',
      RETIRA_CASEROS: 'Retira / Casero',
      LAMINADOS_PRFV: 'Laminados PRFV',
    };
    const { buildOrderPdf } = await import('./order-pdf.builder');
    const products = (order.products as any[]) ?? [];
    const items = products.map((p: any) => ({
      quantity: Number(p?.quantity ?? 1),
      description: String(p?.name ?? '') + (p?.category ? ` (${p.category})` : ''),
      unitPrice: Number(p?.unitPrice ?? 0),
      total: Number(p?.quantity ?? 1) * Number(p?.unitPrice ?? 0),
    }));
    return buildOrderPdf({
      orderNumber: order.orderNumber,
      issueDate: order.createdAt,
      buyerName: order.contact?.name ?? '(sin nombre)',
      buyerPhone: order.contact?.phone ?? null,
      buyerEmail: order.contact?.email ?? null,
      buyerTaxId: fiscalId,
      currency: order.currency,
      items,
      totalAmount: order.amount,
      shipping: {
        address: (meta.address ?? meta.domicilio ?? null) as string | null,
        streetNumber: (meta.streetNumber ?? meta.numero ?? null) as string | null,
        locality: (meta.locality ?? meta.localidad ?? null) as string | null,
        postalCode: (meta.postalCode ?? meta.codigoPostal ?? null) as string | null,
        zone: (order as any).shippingZone ?? null,
        carrier: (order as any).carrier ?? null,
        cost: (order as any).shippingCost ?? null,
      },
      notes: order.notes ?? null,
      sectionLabel: order.sectionOverride ? SECTION_LABELS[order.sectionOverride] ?? order.sectionOverride : null,
    });
  }

  /**
   * Marcos 2026-06-18: DEVOLUCION rows still waiting for the courier
   * to physically bring the wrong package back. Returns the row plus
   * its carrier + zone + cost so the Pedidos panel can show "JyJ /
   * CABA / $3206" alongside each pending pickup.
   */
  async listPendingReturns(): Promise<Array<{
    id: string;
    orderNumber: string;
    contact: { id: string; name: string | null };
    carrier: string | null;
    shippingZone: string | null;
    shippingCost: number | null;
    notes: string | null;
    createdAt: Date;
    createdBy: { id: string; name: string } | null;
  }>> {
    const rows = await this.prisma.order.findMany({
      where: {
        orderType: 'DEVOLUCION',
        returnedAt: null,
        status: { notIn: ['CANCELLED'] as any },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        orderNumber: true,
        carrier: true,
        shippingZone: true,
        shippingCost: true,
        notes: true,
        createdAt: true,
        contact: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.orderNumber,
      contact: { id: r.contact.id, name: r.contact.name },
      carrier: r.carrier,
      shippingZone: r.shippingZone,
      shippingCost: r.shippingCost,
      notes: r.notes,
      createdAt: r.createdAt,
      createdBy: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.name } : null,
    }));
  }

  /**
   * Marcos 2026-06-18: stamp `returnedAt` on a DEVOLUCION row when
   * the courier physically brought the wrong package back. Drops
   * the row from the "Pendientes de regreso" panel. Idempotent.
   */
  async markReturned(orderId: string, returned: boolean, userId: string | null): Promise<{ id: string; orderNumber: string; returnedAt: Date | null } | null> {
    try {
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: returned
          ? { returnedAt: new Date(), returnedById: userId }
          : { returnedAt: null, returnedById: null },
        select: { id: true, orderNumber: true, returnedAt: true },
      });
      return updated;
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  /**
   * Marcos 2026-06-16: Zebra 10×15 cm shipping-label PDF. One label per
   * order — Nombre + Dirección + Localidad + TEL + BULTOS. Pulls the
   * address from Contact.metadata (the quick-client expanded form).
   */
  async renderEtiqueta(orderId: string, bultos: number = 1): Promise<Buffer | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        contact: { select: { name: true, phone: true, metadata: true } },
      },
    });
    if (!order) return null;
    const meta = ((order.contact?.metadata ?? null) as any) || {};
    const street = (meta.address ?? meta.domicilio ?? '') as string;
    const number = (meta.streetNumber ?? meta.numero ?? '') as string;
    const cross = (meta.crossStreet ?? meta.entreCalles ?? '') as string;
    const localidad = (meta.locality ?? meta.localidad ?? null) as string | null;
    const postal = (meta.postalCode ?? meta.codigoPostal ?? null) as string | null;
    const direccionParts = [
      [street, number].filter(Boolean).join(' ').trim(),
      cross ? `entre ${cross}` : null,
      postal ? `CP ${postal}` : null,
    ].filter(Boolean);
    const direccion = direccionParts.length > 0 ? direccionParts.join(' · ') : null;
    const { buildEtiquetaPdf } = await import('./order-etiqueta-pdf.builder');
    return buildEtiquetaPdf({
      nombre: order.contact?.name ?? '',
      direccion,
      localidad,
      telefono: order.contact?.phone ?? null,
      bultos: Math.max(1, Math.min(50, Math.floor(bultos))),
    });
  }

  async getOrderStatistics(): Promise<OrderStatistics> {
    // Marcos 2026-06-17/06-18: only real SALE rows feed the sales
    // metrics — reposiciones (we pay courier) and devoluciones
    // (return-tracking) are operational, not commercial.
    const allOrders = await this.prisma.order.findMany({
      where: { orderType: 'SALE' },
      select: {
        status: true,
        amount: true,
        currency: true,
        products: true,
        createdAt: true,
        dispatchedAt: true,
        deliveredAt: true,
      },
    });

    const totalOrders = allOrders.length;

    // Count by status
    const byStatus: Record<OrderStatus, number> = {
      [OrderStatus.CONFIRMED]: 0,
      [OrderStatus.PROCESSING]: 0,
      [OrderStatus.DISPATCHED]: 0,
      [OrderStatus.DELIVERED]: 0,
      [OrderStatus.CANCELLED]: 0,
    };

    allOrders.forEach((order) => {
      byStatus[order.status]++;
    });

    // Calculate total revenue (USD only for simplicity)
    const totalRevenue = allOrders
      .filter((o) => o.currency === 'USD' && o.status !== OrderStatus.CANCELLED)
      .reduce((sum, o) => sum + o.amount, 0);

    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Revenue by month (last 6 months)
    const revenueByMonth: Array<{ month: string; revenue: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      const monthRevenue = allOrders
        .filter(
          (o) =>
            o.createdAt >= monthStart &&
            o.createdAt <= monthEnd &&
            o.currency === 'USD' &&
            o.status !== OrderStatus.CANCELLED,
        )
        .reduce((sum, o) => sum + o.amount, 0);

      const monthName = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
      });
      revenueByMonth.push({ month: monthName, revenue: monthRevenue });
    }

    // Top products (parse products JSON array)
    const productStats: Record<
      string,
      { quantity: number; revenue: number }
    > = {};

    allOrders
      .filter((o) => o.status !== OrderStatus.CANCELLED)
      .forEach((order) => {
        const products = order.products as any[];
        if (Array.isArray(products)) {
          products.forEach((p) => {
            const name = p.name || p.product || 'Unknown';
            const quantity = p.quantity || 1;
            const price = p.price || 0;

            if (!productStats[name]) {
              productStats[name] = { quantity: 0, revenue: 0 };
            }
            productStats[name].quantity += quantity;
            productStats[name].revenue += price * quantity;
          });
        }
      });

    const topProducts = Object.entries(productStats)
      .map(([product, stats]) => ({
        product,
        quantity: stats.quantity,
        revenue: stats.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Fulfillment metrics
    const fulfillmentMetrics = {
      pending:
        byStatus[OrderStatus.CONFIRMED] + byStatus[OrderStatus.PROCESSING],
      dispatched: byStatus[OrderStatus.DISPATCHED],
      delivered: byStatus[OrderStatus.DELIVERED],
      cancelled: byStatus[OrderStatus.CANCELLED],
      averageFulfillmentTime: 0,
    };

    // Calculate average fulfillment time (from creation to delivery)
    const deliveredOrders = allOrders.filter(
      (o) => o.status === OrderStatus.DELIVERED && o.deliveredAt,
    );

    if (deliveredOrders.length > 0) {
      const totalDays = deliveredOrders.reduce((sum, order) => {
        const days = Math.floor(
          (order.deliveredAt!.getTime() - order.createdAt.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        return sum + days;
      }, 0);
      fulfillmentMetrics.averageFulfillmentTime =
        totalDays / deliveredOrders.length;
    }

    return {
      totalOrders,
      byStatus,
      totalRevenue,
      averageOrderValue,
      revenueByMonth,
      topProducts,
      fulfillmentMetrics,
    };
  }
}
