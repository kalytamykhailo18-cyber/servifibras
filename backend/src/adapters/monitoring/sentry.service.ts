/**
 * ADAPTERS LAYER - Sentry Wrapper
 *
 * Single point of contact for Sentry. Initialised lazily based on .env so
 * the service runs cleanly in environments where DSN isn't yet configured —
 * `captureException` becomes a logged-no-op rather than a throw.
 *
 * Configuration:
 *   SENTRY_DSN              — when set, Sentry is initialised. Empty/missing
 *                              → all capture calls are no-ops.
 *   SENTRY_ENVIRONMENT      — environment tag (default: NODE_ENV or 'dev')
 *   SENTRY_TRACES_SAMPLE_RATE — performance sampling 0..1 (default 0)
 *   SENTRY_RELEASE          — release name (default: git short sha if available)
 */

import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private readonly enabled: boolean;

  constructor() {
    const dsn = process.env.SENTRY_DSN || '';
    this.enabled = dsn.length > 0;

    if (this.enabled) {
      try {
        Sentry.init({
          dsn,
          environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'dev',
          release: process.env.SENTRY_RELEASE,
          tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0') || 0,
        });
        this.logger.log(`✅ Sentry initialised (env=${process.env.SENTRY_ENVIRONMENT || 'dev'})`);
      } catch (err: any) {
        this.logger.error(`Sentry init failed: ${err.message}`);
      }
    } else {
      this.logger.log('Sentry disabled (no SENTRY_DSN configured) — captures are no-ops');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  captureException(err: unknown, context?: Record<string, unknown>): void {
    if (!this.enabled) return;
    try {
      if (context) {
        Sentry.withScope((scope) => {
          for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
          Sentry.captureException(err);
        });
      } else {
        Sentry.captureException(err);
      }
    } catch (e: any) {
      // Never let Sentry errors propagate. Log and move on.
      this.logger.error(`Sentry captureException failed: ${e.message}`);
    }
  }

  captureMessage(message: string, level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'): void {
    if (!this.enabled) return;
    try {
      Sentry.captureMessage(message, level);
    } catch (e: any) {
      this.logger.error(`Sentry captureMessage failed: ${e.message}`);
    }
  }
}
