/**
 * INFRASTRUCTURE LAYER — Quality scoring endpoints.
 *
 *   GET  /admin/quality/me?period=7d         — operator's own scores + sparkline
 *   GET  /admin/quality/team?period=7d       — ADMIN-only team aggregates
 *   POST /admin/quality/:conversationId/rescore  — admin-triggered re-evaluation
 *
 * Roles:
 *   - `me` is visible to every authenticated role; the controller
 *     scopes to `req.user.id` regardless of role.
 *   - `team` and `rescore` are ADMIN-only.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Channel, ConversationSeverity, PrismaClient } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { ConversationScorerService } from '../../../adapters/quality/conversation-scorer.service';
import { QualityPatternService } from '../../../adapters/quality/quality-pattern.service';

import { PrismaService } from '../../../adapters/repositories/prisma.service';
interface DailyPoint {
  date: string;
  avgScore: number | null;
  count: number;
}

@Controller('admin/quality')
@UseGuards(AuthGuard, RolesGuard)
export class QualityController {
  private readonly logger = new Logger(QualityController.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly scorer: ConversationScorerService,
    private readonly pattern: QualityPatternService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Marcos 2026-06-12: import the Prometheo Q&A export so the agent
   * learns the humanised tone he used. Each row of the xlsx becomes
   * a ConversationExample with the buyer's question as the user
   * turn and Prometheo's answer as the assistant turn, scoped to
   * the MERCADOLIBRE channel. Idempotent: scenario carries a hash
   * of (itemId + question) so re-uploading the same workbook
   * upserts instead of duplicating.
   */
  @Post('import-prometheo-qa')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async importPrometheoQa(
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    if (!file?.buffer) throw new BadRequestException('file is required');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
    if (grid.length < 2) return { success: false, error: 'Workbook sin filas' };
    const headers = (grid[0] as any[]).map((h: any) => String(h ?? '').trim().toLowerCase());
    const col = (label: string): number =>
      headers.findIndex((h) => h === label.toLowerCase());
    const iItem  = col('Nro. de Publicación');
    const iTitle = col('Título de la Publicación');
    const iQ     = col('Texto de la pregunta');
    const iA     = col('Texto de la respuesta');
    if (iQ < 0 || iA < 0) {
      throw new BadRequestException('El xlsx no tiene las columnas esperadas (pregunta / respuesta)');
    }
    let created = 0, updated = 0, skipped = 0;
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r] as any[];
      const q = String(row[iQ] ?? '').trim();
      const a = String(row[iA] ?? '').trim();
      if (q.length < 4 || a.length < 4) { skipped++; continue; }
      const itemId = iItem >= 0 ? String(row[iItem] ?? '').trim() : '';
      const title  = iTitle >= 0 ? String(row[iTitle] ?? '').trim() : '';
      const hash = crypto.createHash('sha256').update(`${itemId}::${q}`).digest('hex').slice(0, 16);
      const scenario = `prometheo-import:${hash}`;
      const turns = [
        { role: 'user',      content: q },
        { role: 'assistant', content: a },
      ];
      const existing = await this.prisma.conversationExample.findFirst({
        where: { scenario },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.conversationExample.update({
          where: { id: existing.id },
          data: {
            scenario,
            title: title ? title.slice(0, 200) : null,
            turns: turns as any,
            active: true,
            channel: Channel.MERCADOLIBRE,
            priority: 60,
          },
        });
        updated++;
      } else {
        await this.prisma.conversationExample.create({
          data: {
            scenario,
            title: title ? title.slice(0, 200) : null,
            turns: turns as any,
            active: true,
            channel: Channel.MERCADOLIBRE,
            priority: 60,
          },
        });
        created++;
      }
    }
    this.logger.log(
      `Prometheo Q&A import by ${req.user?.email ?? 'unknown'}: ${created} created, ${updated} updated, ${skipped} skipped`,
    );
    return { success: true, data: { created, updated, skipped } };
  }

  @Get('me')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getMine(@Query('period') period: string | undefined, @Request() req: any) {
    const days = parsePeriodDays(period, 7);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const userId = req.user.id;

    const rows = await this.prisma.conversationScore.findMany({
      where: { assignedToId: userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: { conversation: { select: { id: true, contactId: true } } },
    });

    const latest = rows[0] ?? null;
    const series = bucketByDay(rows.map((r) => ({ at: r.createdAt, score: r.score })), days);
    const avgScore = average(rows.map((r) => r.score));

    return {
      success: true,
      data: {
        windowDays: days,
        latest: latest && {
          conversationId: latest.conversationId,
          score: latest.score,
          strengths: latest.strengths,
          improvement: latest.improvement,
          severeFlag: latest.severeFlag,
          severeReason: latest.severeReason,
          createdAt: latest.createdAt.toISOString(),
        },
        avgScore,
        scoredCount: rows.length,
        series,
      },
    };
  }

  @Get('team')
  // Marcos 2026-06-17: ENCARGADO supervises the team and needs the
  // team-quality aggregates. NOT inherited via ATENCION/LOGISTICA
  // since this endpoint is admin-only by default — granted
  // explicitly here.
  @Roles(UserRole.ADMIN, UserRole.ENCARGADO)
  async getTeam(@Query('period') period: string | undefined) {
    const days = parsePeriodDays(period, 7);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.conversationScore.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: { select: { id: true, name: true, role: true } },
        conversation: { select: { id: true, contactId: true } },
      },
    });

    const series = bucketByDay(rows.map((r) => ({ at: r.createdAt, score: r.score })), days);
    const avgScore = average(rows.map((r) => r.score));

    const missedOpportunities = rows
      .filter((r) => (r.missedOpportunity as any)?.detected)
      .slice(0, 30)
      .map((r) => ({
        scoreId: r.id,
        conversationId: r.conversationId,
        operator: r.assignedTo?.name ?? null,
        reason: (r.missedOpportunity as any)?.reason ?? null,
        score: r.score,
        createdAt: r.createdAt.toISOString(),
      }));

    const severeFlags = rows
      .filter((r) => r.severeFlag !== ConversationSeverity.NONE)
      .slice(0, 30)
      .map((r) => ({
        scoreId: r.id,
        conversationId: r.conversationId,
        operator: r.assignedTo?.name ?? null,
        severeFlag: r.severeFlag,
        severeReason: r.severeReason,
        createdAt: r.createdAt.toISOString(),
      }));

    const patterns = await this.pattern.detectAndAlert();

    return {
      success: true,
      data: {
        windowDays: days,
        avgScore,
        scoredCount: rows.length,
        series,
        missedOpportunities,
        severeFlags,
        patterns: patterns.clusters.filter(
          (c) => c.operatorCount >= (Number(process.env.QUALITY_PATTERN_OPERATOR_THRESHOLD) || 3),
        ),
      },
    };
  }

  @Post(':conversationId/rescore')
  @Roles(UserRole.ADMIN)
  async rescore(@Param('conversationId') conversationId: string) {
    const result = await this.scorer.evaluateAndPersist(conversationId);
    if (result.success) {
      // Trigger pattern detection after a manual rescore so the admin
      // sees the latest cluster state on their next /team fetch.
      void this.pattern.detectAndAlert().catch(() => {});
    }
    return { success: true, data: result };
  }

  /**
   * Promote the scorer's suggested rewrite into a few-shot training
   * example. Marcos's 2026-05-27 ask: "a raíz de los errores ... pueda
   * corregirse a sí misma a futuro". The flow:
   *
   *   1. Scorer evaluates a conversation, emits improvement.suggestedRewrite
   *      (which is the assistant turn rewritten in-place).
   *   2. Admin reviews on the conversation panel, hits "Usar como ejemplo".
   *   3. We materialise the user→assistant pair into ConversationExample
   *      with the rewrite as the assistant turn — next time a similar
   *      customer message arrives, ConversationStyleService loads this
   *      row as a few-shot turn and Claude pattern-matches the fix.
   *
   * Idempotent: re-applying for the same conversation upserts the
   * existing row (title carries the scoreId), so accidentally clicking
   * twice does not duplicate the example.
   */
  @Post(':conversationId/apply-correction')
  @Roles(UserRole.ADMIN)
  async applyCorrection(
    @Param('conversationId') conversationId: string,
    @Request() req: any,
    @Body() body: { overrideAssistantTurn?: unknown } = {},
  ) {
    const override =
      typeof body?.overrideAssistantTurn === 'string' &&
      body.overrideAssistantTurn.trim().length > 0
        ? body.overrideAssistantTurn
        : undefined;
    const result = await this.scorer.promoteRewriteAsExample(conversationId, override);
    // Marcos 2026-06-04: applying a correction implies the row has
    // been reviewed — so it should drop out of the Marcadas queue.
    if (result.success) {
      await this.scorer.markReviewed(conversationId, req.user?.id ?? null).catch(() => {});
    }
    return { success: result.success, data: result };
  }

  /**
   * Mark a flagged conversation as reviewed without applying a
   * correction. Marcos 2026-06-04: "hay que sumar un botón para
   * marcar la pregunta como correcta y que desaparezca de la pestaña
   * de marcadas cuando ya fue revisada o cuando veo que es correcta
   * y no es necesario corregir nada". Keeps severeFlag in place for
   * audit; flips reviewedAt so the Marcadas filter on the ML panel
   * hides this row going forward. POST sets, DELETE clears.
   */
  /**
   * Per-turn correction. Marcos 2026-06-06: in a long conversation he
   * needs to correct ANY assistant turn (not just the last one). The
   * conversation-level `apply-correction` keys the few-shot example by
   * conversationId, so successive corrections on the same conv would
   * overwrite each other. This route accepts a specific messageId and
   * the corrected text; the scorer service writes a new
   * ConversationExample keyed by the messageId so each per-turn
   * correction lands as its own example row.
   *
   * Pair-pick rule: walk back from the target assistant message and
   * find the most recent CUSTOMER message — that's the user side of
   * the pair the next reply will pattern-match against.
   */
  @Post('message/:messageId/apply-correction')
  @Roles(UserRole.ADMIN)
  async applyMessageCorrection(
    @Param('messageId') messageId: string,
    @Body() body: { correctedText?: unknown } = {},
  ) {
    const corrected =
      typeof body?.correctedText === 'string' ? body.correctedText : '';
    const result = await this.scorer.promoteMessageAsExample(messageId, corrected);
    return { success: result.success, data: result };
  }

  @Post(':conversationId/mark-reviewed')
  @Roles(UserRole.ADMIN)
  async markReviewed(
    @Param('conversationId') conversationId: string,
    @Request() req: any,
  ) {
    const result = await this.scorer.markReviewed(conversationId, req.user?.id ?? null);
    return { success: result.success, data: result };
  }

  @Delete(':conversationId/mark-reviewed')
  @Roles(UserRole.ADMIN)
  async unmarkReviewed(
    @Param('conversationId') conversationId: string,
  ) {
    const result = await this.scorer.unmarkReviewed(conversationId);
    return { success: result.success, data: result };
  }

  /**
   * Bulk variant of apply-correction — Marcos 2026-06-02 ask:
   * "es difícil corregir uno a uno, no hay alguna forma masiva de
   * revisar?". The admin sends a list of conversation IDs (the ones
   * they've reviewed and want to promote as training examples) and
   * we run them through the same `promoteRewriteAsExample` flow,
   * returning a per-ID outcome so the panel can show what landed.
   *
   * Idempotent — applying a conversation that already has an example
   * upserts (no duplicates). Capped at 50 IDs per call to keep the
   * request bounded; the panel does its own batching above that.
   */
  @Post('apply-corrections-bulk')
  @Roles(UserRole.ADMIN)
  async applyCorrectionsBulk(
    @Body() body: { conversationIds?: unknown },
  ): Promise<{
    success: boolean;
    data: {
      requested: number;
      applied: number;
      skipped: number;
      results: Array<{
        conversationId: string;
        success: boolean;
        exampleId?: string;
        scenario?: string;
        reason?: string;
      }>;
    };
  }> {
    const raw = Array.isArray(body?.conversationIds) ? body.conversationIds : [];
    const ids = raw
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, 50);
    const results: Array<{
      conversationId: string;
      success: boolean;
      exampleId?: string;
      scenario?: string;
      reason?: string;
    }> = [];
    let applied = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        const r = await this.scorer.promoteRewriteAsExample(id);
        results.push({ conversationId: id, ...r });
        if (r.success) applied++;
        else skipped++;
      } catch (err: any) {
        results.push({
          conversationId: id,
          success: false,
          reason: `error:${err?.message ?? 'unknown'}`,
        });
        skipped++;
      }
    }
    return {
      success: true,
      data: { requested: ids.length, applied, skipped, results },
    };
  }
}

// ---------------- helpers ----------------

function parsePeriodDays(p: string | undefined, fallback: number): number {
  if (!p) return fallback;
  const m = p.match(/^(\d+)d$/);
  if (m) return Math.min(90, Math.max(1, Number(m[1])));
  return fallback;
}

function average(values: Array<number | null>): number | null {
  const n = values.filter((v): v is number => v != null);
  if (n.length === 0) return null;
  const total = n.reduce((a, b) => a + b, 0);
  return Math.round((total / n.length) * 10) / 10;
}

function bucketByDay(rows: Array<{ at: Date; score: number | null }>, days: number): DailyPoint[] {
  const buckets = new Map<string, number[]>();
  for (let d = days - 1; d >= 0; d--) {
    const key = isoDate(new Date(Date.now() - d * 24 * 60 * 60 * 1000));
    buckets.set(key, []);
  }
  for (const row of rows) {
    const key = isoDate(row.at);
    if (!buckets.has(key)) continue;
    if (row.score != null) buckets.get(key)!.push(row.score);
  }
  const out: DailyPoint[] = [];
  for (const [date, scores] of buckets) {
    out.push({
      date,
      avgScore: scores.length === 0 ? null : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
      count: scores.length,
    });
  }
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
