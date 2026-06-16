/**
 * INFRASTRUCTURE LAYER - Metrics Broadcaster
 *
 * Single throttled `metrics:tick` emitter so callers anywhere in the backend
 * can signal "something dashboard-relevant just happened" without risk of
 * spamming connected clients during bursts (e.g. a quick sequence of inbound
 * messages). Frontend reacts by silently refetching `getDashboard()`.
 *
 * The throttle window is read from `.env`:
 *   METRICS_TICK_THROTTLE_MS — minimum ms between two emits (default 500)
 */

import { Injectable, Logger } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';

function throttleMs(): number {
  const raw = process.env.METRICS_TICK_THROTTLE_MS;
  const n = raw != null ? Number(raw) : 500;
  return Number.isFinite(n) && n >= 0 ? n : 500;
}

@Injectable()
export class MetricsBroadcaster {
  private readonly logger = new Logger(MetricsBroadcaster.name);
  private readonly minIntervalMs = throttleMs();
  private lastEmitAt = 0;
  private pending: NodeJS.Timeout | null = null;
  private pendingReason: string | null = null;

  constructor(private readonly gateway: NotificationsGateway) {}

  /**
   * Signal that a dashboard-relevant event just happened. Throttled — multiple
   * calls inside the throttle window collapse into a single trailing emit.
   */
  emitTick(reason: string): void {
    const now = Date.now();
    const since = now - this.lastEmitAt;

    if (since >= this.minIntervalMs) {
      this.fire(reason, now);
      return;
    }

    // Inside the window — schedule a trailing emit if there isn't one already.
    this.pendingReason = reason;
    if (this.pending) return;
    const delay = this.minIntervalMs - since;
    this.pending = setTimeout(() => {
      this.pending = null;
      const r = this.pendingReason ?? 'pending';
      this.pendingReason = null;
      this.fire(r, Date.now());
    }, delay);
  }

  private fire(reason: string, at: number): void {
    this.lastEmitAt = at;
    this.gateway.broadcast('metrics:tick', { reason, at: new Date(at).toISOString() });
  }
}
