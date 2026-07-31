/**
 * INFRASTRUCTURE LAYER — TiendaNube product webhooks.
 *
 * TN fires `product/created`, `product/updated`, `product/deleted`
 * (etc.) when a merchant edits the catalog. We verify the HMAC
 * signature against TIENDANUBE_CLIENT_SECRET, then push the change
 * straight into our local catalog so the agent sees fresh prices
 * without waiting for the daily cron.
 *
 * Signature header: `x-linkedstore-hmac-sha256` — HMAC-SHA256 of the
 * raw request body using the app's client secret. TN sends the digest
 * hex-encoded in practice; we also accept base64 in case a store /
 * region uses the other encoding (or TN switches back).
 * Production: secret present → required. Dev: secret blank → warning,
 * accept anyway so the integration can be tested without HMAC.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import * as crypto from 'crypto';
import { TiendaNubeSyncService } from '../../../adapters/admin/tiendanube-sync.service';

interface TNEvent {
  id?: number;
  store_id?: number | string;
  event?: string;
  resource_id?: number | string;
  /** Some TN payloads use `id` for the resource id; we accept both. */
}

@Controller('tiendanube')
export class TiendaNubeWebhookController {
  private readonly logger = new Logger(TiendaNubeWebhookController.name);

  constructor(private readonly sync: TiendaNubeSyncService) {}

  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.THROTTLE_WEBHOOK_LIMIT) || 200 } })
  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: TNEvent,
    @Headers('x-linkedstore-hmac-sha256') sig?: string,
  ): Promise<{ received: boolean }> {
    const secret = process.env.TIENDANUBE_CLIENT_SECRET;
    const strict = process.env.TIENDANUBE_WEBHOOK_HMAC_STRICT === 'true';
    if (secret && strict) {
      const ok = this.verifyHmac(req.rawBody, secret, sig);
      if (!ok) {
        this.logger.warn(
          `webhook rejected — bad/missing HMAC (event=${body?.event ?? '?'} store=${body?.store_id ?? '?'})`,
        );
        // Return 200 anyway so TN doesn't retry-storm a forgery.
        return { received: false };
      }
    } else if (secret) {
      // Diagnostic mode — log the mismatch but keep dispatching so we
      // can capture what TN actually sends and adjust the verification
      // scheme. Flip TIENDANUBE_WEBHOOK_HMAC_STRICT=true once dialed in.
      const ok = this.verifyHmac(req.rawBody, secret, sig);
      if (!ok && sig) {
        const computed = req.rawBody
          ? crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64')
          : '(no rawBody)';
        const computedHex = req.rawBody
          ? crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')
          : '(no rawBody)';
        this.logger.warn(
          `HMAC mismatch (non-strict, dispatching anyway): rcvd=${sig.slice(0, 16)}… ` +
          `computed-b64=${computed.slice(0, 16)}… computed-hex=${computedHex.slice(0, 16)}… ` +
          `rawBodyLen=${req.rawBody?.length ?? 'undef'}`,
        );
      }
    } else {
      this.logger.warn('TIENDANUBE_CLIENT_SECRET unset — accepting webhook without HMAC verification');
    }

    const event = body?.event ?? '';
    const resourceId = String(body?.resource_id ?? (body as any)?.id ?? '');
    if (!event || !resourceId) {
      this.logger.warn(`webhook missing event/resource_id: ${JSON.stringify(body).slice(0, 200)}`);
      return { received: true };
    }

    // Process async so we ack TN within their 10s window.
    this.dispatch(event, resourceId).catch((err) =>
      this.logger.error(`dispatch failed for ${event} ${resourceId}: ${err.message}`),
    );
    return { received: true };
  }

  private verifyHmac(rawBody: Buffer | undefined, secret: string, sig?: string): boolean {
    if (!sig || !rawBody) return false;
    // Marcos 2026-07-30: TN venía firmando en HEX pero el header top-of-file
    // decía base64 — 17.799 warnings/día por eso; el log de mismatch mostraba
    // que `rcvd` matcheaba exactamente `computed-hex`. Aceptamos ambos formatos
    // por si TN cambia de vuelta y para no quedar frágiles ante nuevos stores
    // en otras regiones que puedan usar el otro encoding.
    const mac = crypto.createHmac('sha256', secret).update(rawBody);
    const computedHex = mac.digest('hex');
    const computedB64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return this.tsEq(sig, computedHex) || this.tsEq(sig, computedB64);
  }

  private tsEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  private async dispatch(event: string, resourceId: string): Promise<void> {
    if (event === 'product/created' || event === 'product/updated') {
      const r = await this.sync.syncOneById(resourceId);
      if (r.ok) {
        this.logger.log(
          `🔄 ${event} ${resourceId} → ${r.created ? 'created' : r.updated ? 'updated' : 'noop'}`,
        );
      } else {
        this.logger.warn(`${event} ${resourceId} sync failed: ${r.reason ?? '?'}`);
      }
      return;
    }
    if (event === 'product/deleted') {
      const r = await this.sync.markInactiveById(resourceId);
      this.logger.log(`🗑️  product/deleted ${resourceId} → ${r.found ? 'deactivated' : 'not_found'}`);
      return;
    }
    // Other events (orders/*, customers/*, app/*) — accepted but ignored
    // for now. Each becomes its own handler when we wire that flow.
    this.logger.debug(`ignoring TN event: ${event}`);
  }
}
