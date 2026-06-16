import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { LeadManagementService } from '../../../adapters/admin/lead-management.service';
import { WeeklyLeadsReportService } from '../../../adapters/admin/weekly-leads-report.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { LeadStatus } from '@prisma/client';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/leads')
@UseGuards(AuthGuard, RolesGuard)
export class LeadsController {
  constructor(
    private readonly leadManagement: LeadManagementService,
    private readonly audit: AuditLogService,
    private readonly weeklyReport: WeeklyLeadsReportService,
  ) {}

  /**
   * POST /admin/leads/report/run
   *
   * ADMIN-only manual trigger for the weekly leads report. Returns the
   * assembled Spanish text + the structured data even when the WhatsApp
   * recipient isn't configured, so Marcos can preview it from the panel.
   */
  @Post('report/run')
  @Roles(UserRole.ADMIN)
  async runWeeklyReport(@Request() req: any) {
    const result = await this.weeklyReport.run();
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'leads.weekly_report.run',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        delivered: result.delivered,
        recipient: result.recipient,
        windowDays: result.data.windowDays,
        totalCreated: result.data.totalCreated,
      },
    });
    return { success: true, data: result };
  }

  /** Helper — pull ip + UA off the request for audit-log entries. */
  private auditCtx(req: any): { ip: string | null; userAgent: string | null } {
    const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
    const userAgent = (req?.headers?.['user-agent'] as string) || null;
    return { ip, userAgent };
  }

  // Get pipeline statistics (must be before :id route)
  @Get('stats/pipeline')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async getPipelineStatistics(@Request() req: any) {
    const data = await this.leadManagement.getPipelineStatistics({
      userId: req.user.id,
      role: req.user.role,
    });
    return { success: true, data };
  }

  // List leads with filters
  @Get()
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async listLeads(
    @Request() req: any,
    @Query('status') status?: LeadStatus,
    @Query('assignedTo') assignedTo?: string,
    @Query('source') source?: string,
    @Query('contactId') contactId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.leadManagement.listLeads({
      status,
      assignedToUserId: assignedTo,
      source: source as any,
      contactId,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      scope: { userId: req.user.id, role: req.user.role },
    });

    return { success: true, ...result };
  }

  // Get lead by ID
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async getLeadById(@Param('id') id: string, @Request() req: any) {
    const data = await this.leadManagement.getLeadById(id, {
      userId: req.user.id,
      role: req.user.role,
    });

    if (!data) {
      throw new NotFoundException('Oportunidad no encontrada');
    }

    return { success: true, data };
  }

  // Create new lead
  @Post()
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async createLead(@Body() body: any) {
    const data = await this.leadManagement.createLead(body);
    return { success: true, data };
  }

  // Update lead
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async updateLead(@Param('id') id: string, @Body() body: any) {
    const data = await this.leadManagement.updateLead(id, body);

    if (!data) {
      throw new NotFoundException('Oportunidad no encontrada');
    }

    return { success: true, data };
  }

  // Delete lead
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteLead(@Param('id') id: string, @Request() req: any) {
    const success = await this.leadManagement.deleteLead(id);
    if (success) {
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'lead.delete',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { leadId: id },
      });
    }
    return { success };
  }

  // Assign lead to user
  @Post(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async assignLead(@Param('id') id: string, @Body() body: { userId: string }) {
    const success = await this.leadManagement.assignLead(id, body.userId);
    return { success };
  }

  // Update lead status
  @Put(':id/status')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async updateLeadStatus(
    @Param('id') id: string,
    @Body() body: { status: LeadStatus; wonAmount?: number; lostReason?: string },
  ) {
    const success = await this.leadManagement.updateLeadStatus(
      id,
      body.status,
      body.wonAmount,
      body.lostReason,
    );
    return { success };
  }
}
