/**
 * INFRASTRUCTURE LAYER — Mayorista detection config endpoints.
 *
 *   GET   /admin/lead-detection/mayorista        — current effective config
 *   PUT   /admin/lead-detection/mayorista        — replace keywords + threshold
 *   POST  /admin/lead-detection/mayorista/probe  — live test against a sample text
 *
 * ADMIN-only. Each write invalidates the in-memory cache so the next
 * inbound message sees the new rules without a redeploy.
 */

import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import {
  DEFAULT_MAYORISTA_KEYWORDS,
  DEFAULT_MAYORISTA_VOLUME_THRESHOLD,
  LeadDetectionConfigService,
} from '../../../adapters/lead-detection/lead-detection-config.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/lead-detection')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class LeadDetectionConfigController {
  private readonly logger = new Logger(LeadDetectionConfigController.name);

  constructor(
    private readonly config: LeadDetectionConfigService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('mayorista')
  async get(): Promise<{ success: true; data: { keywords: string[]; volumeThresholdLitres: number; source: string; defaults: { keywords: string[]; volumeThresholdLitres: number } } }> {
    const cfg = await this.config.getMayoristaConfig();
    return {
      success: true,
      data: {
        keywords: cfg.keywords,
        volumeThresholdLitres: cfg.volumeThresholdLitres,
        source: cfg.source,
        defaults: {
          keywords: DEFAULT_MAYORISTA_KEYWORDS,
          volumeThresholdLitres: DEFAULT_MAYORISTA_VOLUME_THRESHOLD,
        },
      },
    };
  }

  @Put('mayorista')
  async update(
    @Body() body: { keywords?: string[]; volumeThresholdLitres?: number },
    @Request() req: any,
  ): Promise<{ success: true; data: { keywords: string[]; volumeThresholdLitres: number } }> {
    const cfg = await this.config.save({
      keywords: body.keywords,
      volumeThresholdLitres: body.volumeThresholdLitres,
    });
    const ctx = auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'lead_detection.mayorista.update',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        keywordCount: cfg.keywords.length,
        volumeThresholdLitres: cfg.volumeThresholdLitres,
      },
    });
    return {
      success: true,
      data: {
        keywords: cfg.keywords,
        volumeThresholdLitres: cfg.volumeThresholdLitres,
      },
    };
  }

  @Post('mayorista/probe')
  async probe(@Body() body: { text: string }): Promise<{ success: true; data: { isMayorista: boolean; signals: string[]; confidence: number } }> {
    const result = await this.config.probe(body?.text ?? '');
    return { success: true, data: result };
  }
}

function auditCtx(req: any): { ip: string | null; userAgent: string | null } {
  const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
  const userAgent = (req?.headers?.['user-agent'] as string) || null;
  return { ip, userAgent };
}
