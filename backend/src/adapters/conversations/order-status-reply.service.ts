/**
 * ADAPTERS LAYER — Order-status auto-reply.
 *
 * Marcos's brief: "Si el cliente pregunta por su pedido, el agente debe
 * responder con el estado y el tracking sin invocar al humano."
 *
 * Flow:
 *   1) `IOrderStatusIntent` decides if the customer is asking about an order.
 *   2) If so, look up the order:
 *      - prefer the orderNumber the customer pasted ("ORD-2026-1234")
 *      - otherwise, the most recent order belonging to this contact within
 *        the lookup window (env-driven)
 *   3) Compose a deterministic Spanish reply with status + tracking + carrier
 *      + dispatch/delivery date when applicable.
 *
 * Why deterministic (not Claude-generated)?
 *   The reply contains structured order data (numbers, dates, tracking codes)
 *   that an LLM could hallucinate. We hand the customer the exact DB values.
 *
 * Tunable in `.env`:
 *   ORDER_STATUS_REPLY_ENABLED — 'true' / 'false' (default 'true'). Kill-
 *     switch for the whole feature.
 *   ORDER_STATUS_LOOKUP_DAYS — how far back (in days) to consider an order
 *     "current" when the customer didn't paste a number. Default 90.
 *
 * Returning `null` means "no auto-reply, let the AI handle it" — the caller
 * (`ConversationHandlerService`) falls through to Claude on null.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OrderStatus, PrismaClient } from '@prisma/client';
import { PrismaService } from '../repositories/prisma.service';
import {
  IOrderStatusIntent,
  ORDER_STATUS_INTENT,
} from '../../use-cases/conversations/order-status-intent.interface';

function isEnabled(): boolean {
  const raw = process.env.ORDER_STATUS_REPLY_ENABLED;
  if (raw == null || raw.trim().length === 0) return true;
  return raw.trim().toLowerCase() === 'true';
}

function lookupWindowMs(): number {
  const raw = process.env.ORDER_STATUS_LOOKUP_DAYS;
  const days = raw != null ? Number(raw) : 90;
  const safe = Number.isFinite(days) && days > 0 ? days : 90;
  return safe * 24 * 60 * 60 * 1000;
}

function fmtDate(d: Date): string {
  // Spanish dd/mm/yyyy — Argentina convention
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

@Injectable()
export class OrderStatusReplyService {
  private readonly logger = new Logger(OrderStatusReplyService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(ORDER_STATUS_INTENT) private readonly intent: IOrderStatusIntent,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Returns a Spanish auto-reply text, or `null` if no auto-reply applies
   * (intent didn't match, feature disabled, or contact has no recent orders).
   */
  async maybeReply(contactId: string, text: string): Promise<string | null> {
    if (!isEnabled()) return null;
    if (!contactId || !text) return null;

    const det = this.intent.detect(text);
    if (!det.match) return null;

    try {
      const found = await this.findOrder(contactId, det.orderNumber);
      if (!found) {
        // Intent matched but we have no order on file — explicit "we don't
        // see one" message is friendlier than letting Claude guess.
        return this.replyNoOrder(det.orderNumber);
      }
      const reply = this.composeReply(found.order, { ownedByCaller: found.ownedByCaller });
      this.logger.log(
        `Order-status auto-reply for ${found.order.orderNumber} (${found.order.status}) — owned=${found.ownedByCaller} signals=${det.signals.join('|')}`,
      );
      return reply;
    } catch (err: any) {
      // Never block the conversation — fall through to Claude.
      this.logger.error(`Order-status reply failed (non-fatal): ${err.message}`);
      return null;
    }
  }

  private async findOrder(
    contactId: string,
    orderNumber: string | null,
  ): Promise<{ order: any; ownedByCaller: boolean } | null> {
    if (orderNumber) {
      // The intent detector extracts three shapes:
      //   ORD-YYYY-NNNN — manual/CRM orders (canonical form, use as-is)
      //   TN-NNNN       — TiendaNube-synced orders (canonical form, use as-is)
      //   NNNN          — bare digits pulled from "Pedido 15518" — resolve
      //                   against every source's prefix convention.
      const bareDigits = /^\d{3,7}$/.test(orderNumber);
      const candidates: string[] = bareDigits
        ? [
            `TN-${orderNumber}`,
            `ORD-${new Date().getFullYear()}-${orderNumber.padStart(4, '0')}`,
            `ORD-${new Date().getFullYear() - 1}-${orderNumber.padStart(4, '0')}`,
            orderNumber, // last resort: exact match on the digits
          ]
        : [orderNumber];
      // Cross-contact policy (Marcos 2026-08-19 via Ustym): if the number
      // matches an order that belongs to a DIFFERENT contact, still
      // surface the status — real customers routinely write from a
      // different WhatsApp number than the one they used at TN checkout,
      // and the old "no lo veo" cover looked like a broken lookup.
      // Sensitive fields (tracking, carrier, dispatch/delivery dates)
      // are stripped when ownedByCaller=false so we don't leak
      // logistics detail to a phone that isn't on the order.
      for (const key of candidates) {
        const o = await this.prisma.order.findUnique({ where: { orderNumber: key } });
        if (o) return { order: o, ownedByCaller: o.contactId === contactId };
      }
      // Number(s) didn't resolve at all — fall through to latest-by-contact.
    }

    const since = new Date(Date.now() - lookupWindowMs());
    const latest = await this.prisma.order.findFirst({
      where: { contactId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) return null;
    return { order: latest, ownedByCaller: true };
  }

  private replyNoOrder(orderNumber: string | null): string {
    if (orderNumber) {
      return (
        `No encontré ningún pedido con el número ${orderNumber} asociado a tu cuenta. ` +
        `¿Querés que un asesor te ayude a verificarlo?`
      );
    }
    return (
      `No veo pedidos confirmados a tu nombre todavía. ` +
      `Si ya hiciste una compra, decime el número (formato ORD-AAAA-NNNN) y lo reviso. ` +
      `Si querés cotizar uno nuevo, contame qué necesitás.`
    );
  }

  private composeReply(
    order: {
      orderNumber: string;
      status: OrderStatus;
      trackingNumber: string | null;
      carrier: string | null;
      dispatchedAt: Date | null;
      deliveredAt: Date | null;
    },
    opts: { ownedByCaller: boolean } = { ownedByCaller: true },
  ): string {
    const num = order.orderNumber;
    // Cross-contact hits (order exists but belongs to a different contact)
    // still get the status. Logistics detail — tracking code, carrier,
    // dispatch/delivery dates — is withheld so we don't leak it to a
    // phone that isn't the one on the order.
    const showLogistics = opts.ownedByCaller;
    const suffixIfCross = opts.ownedByCaller
      ? ''
      : ' Si el pedido no lo hiciste vos, avisame para que lo verifique un asesor.';
    switch (order.status) {
      case OrderStatus.CONFIRMED:
        return (
          `Tu pedido ${num} está confirmado y en preparación. ` +
          `Te aviso por acá apenas tenga la fecha de despacho.` +
          suffixIfCross
        );

      case OrderStatus.PROCESSING:
        return (
          `Tu pedido ${num} ya está en preparación. ` +
          `Estamos por despacharlo — te paso el seguimiento apenas salga.` +
          suffixIfCross
        );

      case OrderStatus.DISPATCHED: {
        const parts: string[] = [`Tu pedido ${num} ya fue despachado.`];
        if (showLogistics && order.dispatchedAt) {
          parts.push(`Fecha de despacho: ${fmtDate(order.dispatchedAt)}.`);
        }
        if (showLogistics && order.carrier) {
          parts.push(`Transportista: ${order.carrier}.`);
        }
        if (showLogistics && order.trackingNumber) {
          parts.push(`Número de seguimiento: ${order.trackingNumber}.`);
        } else if (showLogistics) {
          parts.push(`Si necesitás el número de seguimiento, te lo paso en un momento.`);
        }
        return parts.join(' ') + suffixIfCross;
      }

      case OrderStatus.DELIVERED: {
        const when = showLogistics && order.deliveredAt ? ` el ${fmtDate(order.deliveredAt)}` : '';
        return (
          `Tu pedido ${num} figura como entregado${when}. ` +
          `Si no lo recibiste o hay algún problema, avisame y lo escalamos.` +
          suffixIfCross
        );
      }

      case OrderStatus.CANCELLED:
        return (
          `Tu pedido ${num} figura como cancelado. ` +
          `Si esto no es lo que esperabas, decime y un asesor lo revisa.` +
          suffixIfCross
        );

      default:
        // OrderStatus is a closed enum so this is unreachable, but keep a
        // sane default just in case the schema grows a new state.
        return (
          `Tu pedido ${num} está en estado "${String(order.status).toLowerCase()}". ` +
          `Si querés más detalle te paso con un asesor.`
        );
    }
  }
}
