/**
 * INFRASTRUCTURE LAYER — Admin Campaigns Controller
 *
 * RBAC: ADMIN-only. Mass outbound to a customer segment is a load-bearing
 * action — narrowing it to one role keeps Brenda from accidentally firing
 * a campaign while triaging her queue.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CustomerType, FunnelStage, Channel } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { CampaignService, CampaignFilters } from '../../../adapters/admin/campaign.service';

function parseFilters(raw: any): CampaignFilters {
  const customerTypes = Array.isArray(raw?.customerTypes)
    ? (raw.customerTypes as string[]).filter((t) => Object.values(CustomerType).includes(t as CustomerType)) as CustomerType[]
    : [];
  const funnelStages = Array.isArray(raw?.funnelStages)
    ? (raw.funnelStages as string[]).filter((s) => Object.values(FunnelStage).includes(s as FunnelStage)) as FunnelStage[]
    : [];
  const channel: Channel | null =
    raw?.channel && Object.values(Channel).includes(raw.channel as Channel)
      ? (raw.channel as Channel)
      : null;
  return { customerTypes, funnelStages, channel };
}

@Controller('admin/campaigns')
@UseGuards(AuthGuard, RolesGuard)
export class CampaignsController {
  private readonly logger = new Logger(CampaignsController.name);

  constructor(private readonly svc: CampaignService) {}

  /** POST /admin/campaigns/preview — segment count + sample names. */
  @Post('preview')
  @Roles(UserRole.ADMIN)
  async preview(@Body() body: any) {
    const filters = parseFilters(body);
    const result = await this.svc.previewSegment(filters);
    return { success: true, data: result };
  }

  /** GET /admin/campaigns — list past campaigns. */
  @Get()
  @Roles(UserRole.ADMIN)
  async list() {
    return { success: true, data: await this.svc.list() };
  }

  /** GET /admin/campaigns/:id — campaign detail with deliveries. */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getOne(@Param('id') id: string) {
    const c = await this.svc.getById(id);
    if (!c) return { success: false, error: 'not found' };
    return { success: true, data: c };
  }

  /** POST /admin/campaigns — create draft + materialise deliveries. */
  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: any, @Request() req: any) {
    if (!body?.name || !body?.messageTemplate) {
      throw new BadRequestException('name and messageTemplate are required');
    }
    const filters = parseFilters(body.filters);
    if (filters.customerTypes.length === 0 && filters.funnelStages.length === 0) {
      throw new BadRequestException('at least one filter dimension is required');
    }
    try {
      const out = await this.svc.create({
        name: body.name,
        messageTemplate: body.messageTemplate,
        filters,
        createdBy: req.user.id,
      });
      this.logger.log(
        `Campaign ${out.campaignId} created by ${req.user.email} — pending=${out.pending} skipped=${out.skipped}`,
      );
      return { success: true, data: out };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  /** POST /admin/campaigns/:id/send — fire the throttled outbound run. */
  @Post(':id/send')
  @Roles(UserRole.ADMIN)
  async send(@Param('id') id: string, @Request() req: any) {
    const result = await this.svc.send(id);
    this.logger.log(
      `Campaign ${id} sent by ${req.user.email} — sent=${result.sent} failed=${result.failed}`,
    );
    return { success: true, data: result };
  }
}
