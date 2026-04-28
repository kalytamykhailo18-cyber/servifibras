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
} from '@nestjs/common';
import { LeadManagementService } from '../../../adapters/admin/lead-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { LeadStatus } from '@prisma/client';

@Controller('admin/leads')
@UseGuards(AuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leadManagement: LeadManagementService) {}

  // Get pipeline statistics (must be before :id route)
  @Get('stats/pipeline')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION)
  async getPipelineStatistics() {
    const data = await this.leadManagement.getPipelineStatistics();
    return { success: true, data };
  }

  // List leads with filters
  @Get()
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION)
  async listLeads(
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
    });

    return { success: true, ...result };
  }

  // Get lead by ID
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION)
  async getLeadById(@Param('id') id: string) {
    const data = await this.leadManagement.getLeadById(id);

    if (!data) {
      return { success: false, error: 'Lead not found' };
    }

    return { success: true, data };
  }

  // Create new lead
  @Post()
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION)
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
      return { success: false, error: 'Lead not found' };
    }

    return { success: true, data };
  }

  // Delete lead
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteLead(@Param('id') id: string) {
    const success = await this.leadManagement.deleteLead(id);
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
