/**
 * ADAPTERS LAYER - Audit Log Service
 *
 * Append-only structured event log for security review, incident response,
 * and compliance. Every privileged action and every login attempt funnels
 * through `log()`. Failures during the write are logged to the application
 * logger but never thrown back to the caller — auditing must never break a
 * user request.
 *
 * Action codes follow `<resource>.<verb>[.<outcome>]` so a future query like
 *   SELECT * FROM access_logs WHERE action LIKE 'auth.login.%'
 * gives you the full login history regardless of outcome.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface AuditEvent {
  /** ID of the authenticated user when known. */
  userId?: string | null;
  /** Email captured for failed-login attempts where userId resolves to null. */
  userEmail?: string | null;
  /** Dotted action code, e.g. 'auth.login.success', 'config.channel.updated'. */
  action: string;
  /** Source IP address. */
  ip?: string | null;
  /** User-Agent header for fingerprinting. */
  userAgent?: string | null;
  /** Structured per-action context (resourceId, fields changed, etc.). */
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.accessLog.create({
        data: {
          userId: event.userId ?? null,
          userEmail: event.userEmail ?? null,
          action: event.action,
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
          metadata: (event.metadata as any) ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to write audit log for ${event.action}: ${err.message}`);
    }
  }

  /** Convenience: pulls IP + UA out of an Express-shaped Request. */
  async logFromRequest(req: { ip?: string; headers?: Record<string, any>; user?: { id?: string } | null }, event: Omit<AuditEvent, 'ip' | 'userAgent'>): Promise<void> {
    const ip = req?.ip ?? null;
    const userAgent = (req?.headers?.['user-agent'] as string | undefined) ?? null;
    return this.log({ ...event, ip, userAgent });
  }

  /**
   * List audit events with optional filters. Cap at 500 rows so an admin
   * accidentally hitting "show all" doesn't pull the whole table into a
   * single response.
   */
  async list(opts: {
    actionPrefix?: string;
    userId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    action: string;
    ip: string | null;
    userAgent: string | null;
    metadata: any;
    createdAt: Date;
  }>> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const where: any = {};
    if (opts.actionPrefix) where.action = { startsWith: opts.actionPrefix };
    if (opts.userId)       where.userId = opts.userId;
    if (opts.since || opts.until) {
      where.createdAt = {};
      if (opts.since) where.createdAt.gte = opts.since;
      if (opts.until) where.createdAt.lte = opts.until;
    }
    const rows = await this.prisma.accessLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      userName: r.user?.name ?? null,
      action: r.action,
      ip: r.ip,
      userAgent: r.userAgent,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Distinct action codes seen in the past N days — for the filter
   * dropdown. Uses Prisma's distinct shortcut.
   */
  async listActions(daysBack = 30): Promise<string[]> {
    const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
    const rows = await this.prisma.accessLog.findMany({
      where: { createdAt: { gte: since } },
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
      take: 200,
    });
    return rows.map((r) => r.action);
  }
}
