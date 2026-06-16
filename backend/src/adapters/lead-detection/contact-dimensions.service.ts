/**
 * ADAPTERS LAYER - Contact Dimensions Service
 *
 * Drives the two-axis classification of every contact:
 *   - customerType (ARTESANO / EMPRENDEDOR / MAYORISTA / INDUSTRIAL / PRFV_LAMINADOS / PROVEEDOR)
 *   - funnelStage  (CONSULTA / COTIZADO / NO_CONCRETO / COMPRADOR / FRECUENTE / REACTIVAR)
 *
 * Funnel-stage transitions are deterministic from existing events:
 *   - first inbound message      → CONSULTA   (only if currently null)
 *   - lead.status QUOTE_SENT     → COTIZADO
 *   - lead.status WON OR order created OR lead.status NEGOTIATING-with-quote → at least COMPRADOR
 *   - lead.status LOST           → NO_CONCRETO
 *   - 2nd or later order from same contact → FRECUENTE
 *
 * State NEVER regresses on its own — once a contact is COMPRADOR, a new
 * inbound message doesn't push them back to CONSULTA. A regression only
 * happens via explicit admin override (which would write directly).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, CustomerType, FunnelStage } from '@prisma/client';
import {
  CUSTOMER_TYPE_DETECTOR,
  ICustomerTypeDetector,
} from '../../use-cases/lead-detection/customer-type-detector.interface';

// Minimum detector confidence (0..1) before we auto-apply a customer-type.
// Below this, the contact stays unclassified and admin can set it manually.
// Tunable via .env so Marcos can dial detection sensitivity without a code
// change. Default 0.33 = roughly "at least one detector hit".
function minTypeConfidence(): number {
  const raw = process.env.CUSTOMER_TYPE_MIN_CONFIDENCE;
  const n = raw != null ? Number(raw) : 0.33;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.33;
}

// Higher = "further along the funnel". State only moves up unless an admin
// manually overrides.
const STAGE_ORDER: Record<FunnelStage, number> = {
  CONSULTA: 1,
  COTIZADO: 2,
  NO_CONCRETO: 3,
  COMPRADOR: 4,
  FRECUENTE: 5,
  REACTIVAR: 6, // not strictly "further" — set by reactivation jobs only
};

function isAtLeast(current: FunnelStage | null, target: FunnelStage): boolean {
  return current != null && STAGE_ORDER[current] >= STAGE_ORDER[target];
}

@Injectable()
export class ContactDimensionsService {
  private readonly logger = new Logger(ContactDimensionsService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(CUSTOMER_TYPE_DETECTOR)
    private readonly typeDetector: ICustomerTypeDetector,
  ) {}

  /**
   * Run on every inbound customer message. Sets:
   *   - customerType if it was null and the detector finds a clear signal
   *   - funnelStage = CONSULTA if it was null (never regresses)
   *
   * Errors are logged, never thrown — classification must not break the
   * customer-reply pipeline.
   */
  async classifyOnInbound(contactId: string, text: string): Promise<void> {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        select: { customerType: true, funnelStage: true },
      });
      if (!contact) return;

      const updates: { customerType?: CustomerType; funnelStage?: FunnelStage } = {};
      if (!contact.customerType) {
        const detection = await this.typeDetector.detect(text);
        if (detection.type && detection.confidence >= minTypeConfidence()) {
          updates.customerType = detection.type as CustomerType;
        }
      }
      if (!contact.funnelStage) {
        updates.funnelStage = FunnelStage.CONSULTA;
      }
      if (Object.keys(updates).length > 0) {
        await this.prisma.contact.update({ where: { id: contactId }, data: updates });
        this.logger.log(`📊 Contact ${contactId} dimensions: ${JSON.stringify(updates)}`);
      }
    } catch (err: any) {
      this.logger.error(`classifyOnInbound failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Lead status changed → reflect on the contact's funnel stage. Forward-only.
   */
  async onLeadStatusChange(contactId: string, leadStatus: string): Promise<void> {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        select: { funnelStage: true },
      });
      if (!contact) return;

      let target: FunnelStage | null = null;
      switch (leadStatus) {
        case 'QUOTE_SENT':
          target = FunnelStage.COTIZADO;
          break;
        case 'WON':
          target = FunnelStage.COMPRADOR;
          break;
        case 'LOST':
          target = FunnelStage.NO_CONCRETO;
          break;
        // CONTACTED, NEGOTIATING — leave the stage alone, the explicit
        // QUOTE_SENT / WON / LOST transitions are the canonical signals.
      }
      if (!target) return;

      // Forward-only — except NO_CONCRETO which can replace CONSULTA/COTIZADO
      // even if it would visually "regress" (it's a terminal-ish state).
      const ok = target === FunnelStage.NO_CONCRETO || !isAtLeast(contact.funnelStage, target);
      if (!ok) return;
      await this.prisma.contact.update({
        where: { id: contactId },
        data: { funnelStage: target },
      });
      this.logger.log(`📊 Contact ${contactId} funnelStage → ${target} (lead ${leadStatus})`);
    } catch (err: any) {
      this.logger.error(`onLeadStatusChange failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Order created → COMPRADOR (or FRECUENTE if this is their 2nd+).
   */
  async onOrderCreated(contactId: string): Promise<void> {
    try {
      const orderCount = await this.prisma.order.count({ where: { contactId } });
      const target = orderCount >= 2 ? FunnelStage.FRECUENTE : FunnelStage.COMPRADOR;
      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        select: { funnelStage: true },
      });
      if (!contact) return;
      // Forward-only
      if (isAtLeast(contact.funnelStage, target)) return;
      await this.prisma.contact.update({
        where: { id: contactId },
        data: { funnelStage: target },
      });
      this.logger.log(`📊 Contact ${contactId} funnelStage → ${target} (order#${orderCount})`);
    } catch (err: any) {
      this.logger.error(`onOrderCreated failed (non-fatal): ${err.message}`);
    }
  }
}
