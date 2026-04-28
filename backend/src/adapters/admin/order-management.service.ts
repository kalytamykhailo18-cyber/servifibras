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

@Injectable()
export class OrderManagementService implements IOrderManagementService {
  private prisma: PrismaClient;

  constructor() {
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
    const { status, contactId, orderNumber, limit = 20, offset = 0 } = filter;

    const where: any = {};
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;
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
    const orderNumber = this.generateOrderNumber();

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        contactId: data.contactId,
        amount: data.amount,
        currency: data.currency || 'USD',
        products: data.products,
        notes: data.notes,
        status: OrderStatus.CONFIRMED,
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

  async getOrderStatistics(): Promise<OrderStatistics> {
    const allOrders = await this.prisma.order.findMany({
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
