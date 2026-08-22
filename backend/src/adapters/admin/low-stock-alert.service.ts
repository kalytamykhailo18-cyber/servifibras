/**
 * ADAPTERS LAYER — Low-stock alert.
 *
 * Marcos's brief: "Alerta interna cuando un producto en TiendaNube cae por
 * debajo del umbral (umbral por producto)."
 *
 * The check is a single read after every mutation that can lower the
 * stock quantity (manual product edit, TN sync upsert). When `stockQuantity
 * <= threshold`, we emit `product:low_stock` to the ADMIN + LOGISTICA
 * Socket.io rooms and update `lastLowStockAlertAt` so we don't refire for
 * every redundant write.
 *
 * Threshold resolution order:
 *   1. `Product.lowStockThreshold` (per-row override)
 *   2. `PRODUCT_LOW_STOCK_DEFAULT_THRESHOLD` from .env
 *   3. fallback constant 5
 *
 * Cooldown:
 *   `PRODUCT_LOW_STOCK_COOLDOWN_HOURS` (.env, default 24) is the minimum
 *   time between two alerts for the SAME product. Once the operator
 *   restocks above threshold and the stock dips again later, the next
 *   alert fires regardless of cooldown — the row's threshold-crossing
 *   transition is the trigger.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';
import { AuditLogService } from '../audit/audit-log.service';

import { PrismaService } from '../repositories/prisma.service';
const FALLBACK_THRESHOLD = 5;
const FALLBACK_COOLDOWN_HOURS = 24;

function envNumber(key: string, fallback: number, min = 0): number {
  const raw = process.env[key];
  const n = raw != null && raw !== '' ? Number(raw) : fallback;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

@Injectable()
export class LowStockAlertService {
  private readonly logger = new Logger(LowStockAlertService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly notifications: NotificationsGateway,
    private readonly audit: AuditLogService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Run the alert check for a single product. Safe to call after any
   * write that may have reduced stock; never throws — alert failures
   * never break the caller's path.
   */
  async checkAndAlert(productId: string): Promise<{ fired: boolean; reason?: string }> {
    try {
      const p = await this.prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          sku: true,
          name: true,
          baseUnit: true,
          stockQuantity: true,
          inStock: true,
          active: true,
          lowStockThreshold: true,
          lastLowStockAlertAt: true,
        },
      });
      if (!p) return { fired: false, reason: 'product not found' };
      if (!p.active) return { fired: false, reason: 'inactive' };
      if (p.stockQuantity == null) return { fired: false, reason: 'untracked stock' };

      const threshold =
        p.lowStockThreshold != null
          ? p.lowStockThreshold
          : envNumber('PRODUCT_LOW_STOCK_DEFAULT_THRESHOLD', FALLBACK_THRESHOLD, 0);
      if (p.stockQuantity > threshold) {
        return { fired: false, reason: 'above threshold' };
      }

      const cooldownH = envNumber('PRODUCT_LOW_STOCK_COOLDOWN_HOURS', FALLBACK_COOLDOWN_HOURS, 0);
      if (p.lastLowStockAlertAt != null && cooldownH > 0) {
        const elapsedMs = Date.now() - p.lastLowStockAlertAt.getTime();
        if (elapsedMs < cooldownH * 60 * 60 * 1000) {
          return { fired: false, reason: 'cooldown' };
        }
      }

      const payload = {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        baseUnit: p.baseUnit,
        stockQuantity: p.stockQuantity,
        threshold,
        inStock: p.inStock,
        at: new Date().toISOString(),
      };

      this.notifications.emitToRole('ADMIN', 'product:low_stock', payload);
      this.notifications.emitToRole('LOGISTICA', 'product:low_stock', payload);

      await this.prisma.product.update({
        where: { id: p.id },
        data: { lastLowStockAlertAt: new Date() },
      });

      // Audit log: the alert is operationally significant — Marcos may
      // want to backfill missed signals from this trail later.
      await this.audit
        .log({
          userId: null,
          userEmail: null,
          action: 'product.low_stock.alert',
          ip: null,
          userAgent: null,
          metadata: payload,
        })
        .catch(() => {
          /* audit failure should never break the alert path */
        });

      this.logger.log(
        `📉 Low-stock alert fired for ${p.sku} (${p.stockQuantity} ${p.baseUnit} ≤ ${threshold})`,
      );
      return { fired: true };
    } catch (err: any) {
      this.logger.error(`Low-stock check failed (non-fatal): ${err.message}`);
      return { fired: false, reason: `error: ${err.message}` };
    }
  }

  /**
   * Bulk variant — used after a TN sync run that touched many products.
   * Each product is checked sequentially; cooldown plus the threshold
   * filter keep emission bounded even with thousands of products.
   */
  async checkMany(productIds: string[]): Promise<{ fired: number; checked: number }> {
    let fired = 0;
    for (const id of productIds) {
      const r = await this.checkAndAlert(id);
      if (r.fired) fired++;
    }
    return { fired, checked: productIds.length };
  }
}
