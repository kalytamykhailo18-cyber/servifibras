/**
 * INFRASTRUCTURE LAYER — ML batch queue admin endpoints.
 *
 * Visibility (counts, list) is ADMIN-only — this is internal cost
 * plumbing that operators don't need to see day-to-day. Force-
 * dispatch / force-poll buttons let Marcos drain the queue on
 * demand (e.g. before a deploy) without waiting for the cron.
 */

import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MlBatchEntryStatus } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { MlBatchQueueService } from '../../../adapters/ai/ml-batch-queue.service';

const VALID_STATES = new Set<MlBatchEntryStatus>([
  MlBatchEntryStatus.PENDING,
  MlBatchEntryStatus.DISPATCHED,
  MlBatchEntryStatus.ANSWERED,
  MlBatchEntryStatus.FAILED,
  MlBatchEntryStatus.FALLBACK,
]);

@Controller('admin/ml-batch-queue')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MlBatchQueueController {
  private readonly logger = new Logger(MlBatchQueueController.name);

  constructor(private readonly svc: MlBatchQueueService) {}

  @Get('status')
  async status() {
    return {
      success: true,
      data: {
        enabled: MlBatchQueueService.modeEnabled(),
        counts: await this.svc.counts(),
      },
    };
  }

  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string) {
    let statusFilter: MlBatchEntryStatus | undefined;
    if (status) {
      const candidate = status.toUpperCase() as MlBatchEntryStatus;
      if (VALID_STATES.has(candidate)) statusFilter = candidate;
    }
    const limitNum = limit ? Number(limit) : undefined;
    const rows = await this.svc.list({
      status: statusFilter,
      limit: Number.isFinite(limitNum) && (limitNum as number) > 0 ? limitNum : undefined,
    });
    return { success: true, data: rows };
  }

  /**
   * Drain PENDING entries into a batch right now, regardless of the
   * min-batch-size guard. Useful when Marcos wants to "ship the
   * queue" without waiting for the next cron tick.
   */
  @Post('dispatch')
  async forceDispatch(@Body() _body: any) {
    const r = await this.svc.dispatchPending({ force: true });
    this.logger.log(`force-dispatch → batch=${r.batchId} dispatched=${r.dispatched}`);
    return { success: true, data: r };
  }

  /**
   * Poll every DISPATCHED batch immediately, finalize anything
   * that's done, and post answers to ML. Used when Marcos wants to
   * "fetch results now".
   */
  @Post('poll')
  async forcePoll() {
    const r = await this.svc.pollAndFinalize();
    return { success: true, data: r };
  }
}
