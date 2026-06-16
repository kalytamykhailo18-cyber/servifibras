/**
 * INFRASTRUCTURE LAYER — Laminados PRFV pricelist endpoints.
 *
 *   GET   /admin/laminados/pricelist          — current effective pricelist
 *   POST  /admin/laminados/upload-pricelist   — multipart xlsx upload, parses Marcos's workbook
 *                                                and persists to the `laminados.pricelist`
 *                                                Configuration row
 *   POST  /admin/laminados/reset              — wipe back to baked-in defaults
 *
 * ADMIN-only — the pricelist drives cotizar_laminado for every channel,
 * so only admins (Marcos / Ustym) can change it.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import {
  LaminadosPriceConfigService,
  LaminadosPricelist,
} from '../../../adapters/pricing/laminados-price-config.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/laminados')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class LaminadosController {
  private readonly logger = new Logger(LaminadosController.name);

  constructor(
    private readonly priceConfig: LaminadosPriceConfigService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('pricelist')
  async getPricelist(): Promise<{ success: true; data: LaminadosPricelist & { defaults: LaminadosPricelist } }> {
    const pl = await this.priceConfig.getPricelist();
    return {
      success: true,
      data: {
        ...pl,
        defaults: this.priceConfig.getBakedInDefaults(),
      },
    };
  }

  @Post('upload-pricelist')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPricelist(
    @UploadedFile() file: any,
    @Request() req: any,
  ): Promise<{ success: true; data: LaminadosPricelist }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('file is required (multipart field "file")');
    }
    const name = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const xlsxOk =
      name.endsWith('.xlsx') ||
      mime.includes('spreadsheetml') ||
      mime.includes('vnd.ms-excel') ||
      mime.includes('octet-stream'); // some browsers send octet-stream
    if (!xlsxOk) {
      throw new BadRequestException(`expected .xlsx, got name="${file.originalname}" mime="${mime}"`);
    }
    if (file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('xlsx exceeds 5 MB limit');
    }

    let parsed: LaminadosPricelist;
    try {
      parsed = this.priceConfig.parseXlsx(file.buffer);
    } catch (err: any) {
      throw new BadRequestException(`xlsx parse failed: ${err?.message ?? err}`);
    }

    const saved = await this.priceConfig.savePricelist(parsed, req.user?.email);
    const ctx = auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'laminados.pricelist.upload',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        filename: file.originalname || null,
        bytes: file.buffer.length,
        productCount: parsed.products.length,
        tierCount: parsed.discountTiers.length,
        iva: parsed.iva,
        fallbackArsPorUsd: parsed.fallbackArsPorUsd,
      },
    });
    this.logger.log(
      `pricelist uploaded by ${req.user?.email}: ${parsed.products.length} products, ${parsed.discountTiers.length} tiers`,
    );
    return { success: true, data: saved };
  }

  @Post('reset')
  async reset(@Request() req: any): Promise<{ success: true; data: LaminadosPricelist }> {
    const saved = await this.priceConfig.resetToDefaults(req.user?.email);
    const ctx = auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'laminados.pricelist.reset',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {},
    });
    return { success: true, data: saved };
  }
}

function auditCtx(req: any): { ip: string | null; userAgent: string | null } {
  const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
  const userAgent = (req?.headers?.['user-agent'] as string) || null;
  return { ip, userAgent };
}
