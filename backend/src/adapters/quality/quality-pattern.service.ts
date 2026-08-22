/**
 * ADAPTERS LAYER — Repeated-error pattern detection.
 *
 * After every score write, group recent low-scoring conversations by
 * the `improvement.reason` cluster and count distinct operators per
 * cluster. When a cluster exceeds `QUALITY_PATTERN_OPERATOR_THRESHOLD`
 * (default 3) distinct operators within `QUALITY_PATTERN_LOOKBACK_DAYS`
 * (default 14), emit `quality:pattern_detected` to the ADMIN role
 * (visible on every admin's open session) and persist an audit row.
 *
 * Clustering today is a coarse first-N-chars-of-reason hash. Good
 * enough until we have enough signal to upgrade to embeddings.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';
import { AuditLogService } from '../audit/audit-log.service';

import { PrismaService } from '../repositories/prisma.service';
@Injectable()
export class QualityPatternService {
  private readonly logger = new Logger(QualityPatternService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly notifications: NotificationsGateway,
    private readonly audit: AuditLogService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  async detectAndAlert(): Promise<{
    clusters: Array<{ key: string; reason: string; operatorCount: number; operatorIds: string[] }>;
    fired: number;
  }> {
    const threshold = Number(process.env.QUALITY_PATTERN_OPERATOR_THRESHOLD) || 3;
    const lookbackDays = Number(process.env.QUALITY_PATTERN_LOOKBACK_DAYS) || 14;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.conversationScore.findMany({
      where: {
        createdAt: { gte: since },
        score: { not: null, lte: 7 },
        assignedToId: { not: null },
      },
      select: {
        assignedToId: true,
        improvement: true,
        createdAt: true,
      },
    });

    const byCluster = new Map<string, { reason: string; operators: Set<string> }>();
    for (const row of rows) {
      const reason = (row.improvement as any)?.reason ?? '';
      if (!reason || typeof reason !== 'string') continue;
      const key = clusterKey(reason);
      if (!key) continue;
      const slot = byCluster.get(key) ?? { reason, operators: new Set<string>() };
      if (row.assignedToId) slot.operators.add(row.assignedToId);
      byCluster.set(key, slot);
    }

    const clusters = [...byCluster.entries()]
      .map(([key, v]) => ({
        key,
        reason: v.reason,
        operatorCount: v.operators.size,
        operatorIds: [...v.operators],
      }))
      .sort((a, b) => b.operatorCount - a.operatorCount);

    let fired = 0;
    for (const cluster of clusters) {
      if (cluster.operatorCount < threshold) continue;
      this.notifications.emitToRole('ADMIN', 'quality:pattern_detected', {
        cluster: cluster.key,
        reason: cluster.reason,
        operatorCount: cluster.operatorCount,
        operatorIds: cluster.operatorIds,
        thresholdHit: threshold,
        at: new Date().toISOString(),
      });
      try {
        await this.audit.log({
          action: 'quality.pattern.detected',
          metadata: {
            cluster: cluster.key,
            reason: cluster.reason,
            operatorCount: cluster.operatorCount,
            operatorIds: cluster.operatorIds,
          },
        });
      } catch (err: any) {
        this.logger.warn(`audit log of pattern failed (non-fatal): ${err.message}`);
      }
      fired++;
    }
    return { clusters, fired };
  }
}

/** Coarse cluster key — lowercase, alpha-only, first 60 chars. Good
 *  enough to merge "respondió tarde" / "respondió fuera de horario"
 *  while keeping "no aplicó descuento" separate from "no derivó al
 *  asesor". Upgrade path: embedding similarity. */
function clusterKey(reason: string): string {
  const norm = reason
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return norm.slice(0, 60);
}
