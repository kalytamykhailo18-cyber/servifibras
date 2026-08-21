/**
 * ADAPTERS LAYER - Order Notification Service
 *
 * Marcos's brief: "Notificación automática a logística cuando se confirma
 * pedido mayorista con detalle de productos."
 *
 * On every order create, this service decides whether the order should
 * trigger a logistics alert. The current rule is:
 *
 *   - Contact's customerType is one of MAYORISTA / INDUSTRIAL / PRFV_LAMINADOS
 *     → emit `order:created` to the first active LOGISTICA user (Aldo today)
 *     with full product detail in the payload.
 *
 *   - Otherwise (artesanos, emprendedores, proveedor) → no per-order alert;
 *     these go through the regular orders queue without paging Aldo.
 *
 * Tunable in `.env`:
 *   ORDER_ALERT_CUSTOMER_TYPES — comma-separated whitelist of customer-type
 *     codes that should trigger the alert (default
 *     "MAYORISTA,INDUSTRIAL,PRFV_LAMINADOS"). Set this if Marcos wants to
 *     widen or narrow the rule without a code change.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, UserRole, CustomerType } from '@prisma/client';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';

function alertableTypes(): Set<string> {
  const raw = process.env.ORDER_ALERT_CUSTOMER_TYPES;
  if (raw && raw.trim().length > 0) {
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  }
  // Default: wholesale tier and bigger.
  return new Set([CustomerType.MAYORISTA, CustomerType.INDUSTRIAL, CustomerType.PRFV_LAMINADOS]);
}

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly notifications: NotificationsGateway,
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Called from `OrderManagementService.createOrder` after the order row
   * is committed. Errors are logged, never thrown — notification failures
   * must never break order creation.
   */
  async notifyIfWholesale(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          contact: {
            select: {
              id: true, name: true, phone: true, email: true,
              customerType: true, type: true,
            },
          },
        },
      });
      if (!order) return;

      const types = alertableTypes();
      // We rely primarily on the new customerType dimension. Fall back to
      // legacy `type` (MAYORISTA / INDUSTRIAL) so this works correctly even
      // for contacts that haven't been re-classified yet.
      const ct = (order.contact.customerType ?? null) as string | null;
      const legacy = order.contact.type as string;
      const shouldAlert = (ct && types.has(ct)) || (legacy && types.has(legacy));
      if (!shouldAlert) {
        return;
      }

      // Find the routing target — first active LOGISTICA user (Aldo today;
      // future-proof for multiple logistics ops).
      const aldo = await this.prisma.user.findFirst({
        where: { role: UserRole.LOGISTICA, active: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true },
      });

      const payload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        contact: {
          id: order.contact.id,
          name: order.contact.name,
          phone: order.contact.phone,
          email: order.contact.email,
          customerType: order.contact.customerType,
        },
        amount: order.amount,
        currency: order.currency,
        products: order.products,
        status: order.status,
        at: new Date().toISOString(),
      };

      if (aldo) {
        this.notifications.emitToUser(aldo.id, 'order:created', payload);
        this.logger.log(
          `📦 Wholesale order ${order.orderNumber} → ${aldo.email} (${ct ?? legacy})`,
        );
      } else {
        // No LOGISTICA user — broadcast so any future role-listener picks
        // it up. Beats silently dropping the alert.
        this.notifications.broadcast('order:created', payload);
        this.logger.warn(
          `Wholesale order ${order.orderNumber} broadcast (no LOGISTICA user found)`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Order notification failed (non-fatal): ${err.message}`);
    }
  }
}
