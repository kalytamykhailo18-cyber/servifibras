/**
 * INFRASTRUCTURE LAYER — Admin Quotes Controller.
 *
 * RBAC: ADMIN + VENTAS. Franco needs to send presupuestos as part of the
 * sales pipeline; admin gets it for cleanup / oversight.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { QuoteStatus } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { QuoteService } from '../../../adapters/admin/quote.service';

const QUOTE_ROLES = [UserRole.ADMIN, UserRole.VENTAS];

@Controller('admin/quotes')
@UseGuards(AuthGuard, RolesGuard)
export class QuotesController {
  private readonly logger = new Logger(QuotesController.name);

  constructor(private readonly svc: QuoteService) {}

  @Get()
  @Roles(...QUOTE_ROLES)
  async list(
    @Query('contactId') contactId?: string,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.svc.list({
      contactId: contactId || undefined,
      leadId:    leadId    || undefined,
      status:    (status as QuoteStatus) || undefined,
    });
    return { success: true, data: items };
  }

  @Get(':id')
  @Roles(...QUOTE_ROLES)
  async getOne(@Param('id') id: string) {
    const q = await this.svc.getById(id);
    if (!q) return { success: false, error: 'not found' };
    return { success: true, data: q };
  }

  @Post()
  @Roles(...QUOTE_ROLES)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const created = await this.svc.create({ ...body, createdBy: req.user.id });
      this.logger.log(`Quote ${created.quoteNumber} created by ${req.user.email}`);
      return { success: true, data: created };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Put(':id/status')
  @Roles(...QUOTE_ROLES)
  async setStatus(@Param('id') id: string, @Body() body: { status: QuoteStatus }) {
    const updated = await this.svc.setStatus(id, body.status);
    if (!updated) return { success: false, error: 'not found' };
    return { success: true, data: updated };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    const ok = await this.svc.delete(id);
    return { success: ok };
  }

  /**
   * GET /admin/quotes/:id/pdf
   *
   * Returns the rendered presupuesto as application/pdf with an inline
   * Content-Disposition so it opens in the browser tab. Auth flows
   * through the standard guard — frontend must fetch with the bearer
   * token and turn the response blob into an object URL.
   */
  @Get(':id/pdf')
  @Roles(...QUOTE_ROLES)
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.svc.renderPdf(id);
    if (!buf) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, error: 'not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="presupuesto.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  }
}
