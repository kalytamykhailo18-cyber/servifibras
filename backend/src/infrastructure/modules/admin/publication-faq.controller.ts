/**
 * INFRASTRUCTURE LAYER — Per-publication FAQ controller.
 *
 * Backs the "FAQ por publicación" panel that lets operators turn a
 * recurring ML buyer question into an instant canned answer (no
 * Claude call). All endpoints under /admin/publication-faqs are
 * available to ADMIN, ATENCION and VENTAS — the same roles that work
 * the ML Q&A panel.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { PublicationFaqService } from '../../../adapters/admin/publication-faq.service';

@Controller('admin/publication-faqs')
@UseGuards(AuthGuard, RolesGuard)
export class PublicationFaqController {
  private readonly logger = new Logger(PublicationFaqController.name);

  constructor(private readonly svc: PublicationFaqService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async list(
    @Query('itemId') itemId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const rows = await this.svc.list({
      itemId: itemId?.trim() || undefined,
      activeOnly: activeOnly === '1' || activeOnly === 'true',
    });
    return { success: true, data: rows };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async getById(@Param('id') id: string) {
    const row = await this.svc.getById(id);
    if (!row) throw new NotFoundException('publication FAQ not found');
    return { success: true, data: row };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const row = await this.svc.create(
        {
          itemId: String(body?.itemId ?? ''),
          keywords: body?.keywords ?? [],
          answer: String(body?.answer ?? ''),
          active: body?.active !== false,
        },
        req.user?.id ?? null,
      );
      this.logger.log(`Publication FAQ ${row.id.slice(0, 8)} created by ${req.user?.email ?? 'unknown'}`);
      return { success: true, data: row };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  /**
   * "Crear FAQ desde Q&A" helper — given a customer question text the
   * operator clicked on in the ML Q&A panel, returns suggested keywords
   * so the dialog opens pre-filled instead of empty.
   */
  @Post('suggest-keywords')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async suggestKeywords(@Body() body: any) {
    const text = String(body?.text ?? '');
    if (!text) throw new BadRequestException('text is required');
    return { success: true, data: this.svc.suggestKeywordsFromText(text) };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    try {
      const row = await this.svc.update(id, {
        itemId: body?.itemId,
        keywords: body?.keywords,
        answer: body?.answer,
        active: body?.active,
      });
      if (!row) throw new NotFoundException('publication FAQ not found');
      this.logger.log(`Publication FAQ ${id.slice(0, 8)} updated by ${req.user?.email ?? 'unknown'}`);
      return { success: true, data: row };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException(err.message);
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string, @Request() req: any) {
    const ok = await this.svc.delete(id);
    if (!ok) throw new NotFoundException('publication FAQ not found');
    this.logger.log(`Publication FAQ ${id.slice(0, 8)} deleted by ${req.user?.email ?? 'unknown'}`);
    return { success: true };
  }
}
