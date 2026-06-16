/**
 * INFRASTRUCTURE LAYER - Admin Contacts Controller
 * Manages contact CRUD operations, search, and statistics
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ContactManagementService } from '../../../adapters/admin/contact-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { Channel, ContactType } from '@prisma/client';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/contacts')
@UseGuards(AuthGuard, RolesGuard)
export class ContactsController {
  private readonly logger = new Logger(ContactsController.name);

  constructor(
    private readonly contactManagement: ContactManagementService,
    private readonly audit: AuditLogService,
  ) {}

  /** Helper — pull ip + UA off the request for audit-log entries. */
  private auditCtx(req: any): { ip: string | null; userAgent: string | null } {
    const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
    const userAgent = (req?.headers?.['user-agent'] as string) || null;
    return { ip, userAgent };
  }

  /**
   * Get contact statistics
   * GET /admin/contacts/stats/summary
   */
  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getStatistics() {
    const stats = await this.contactManagement.getStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Search contacts
   * GET /admin/contacts/search
   */
  @Get('search')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async searchContacts(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    if (!query) {
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }

    const contacts = await this.contactManagement.searchContacts(
      query,
      limit ? parseInt(limit) : 20,
    );

    return {
      success: true,
      data: contacts,
      total: contacts.length,
    };
  }

  /**
   * List all contacts with filters
   * GET /admin/contacts
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async listContacts(
    @Query('channel') channel?: Channel,
    @Query('search') search?: string,
    @Query('hasActiveConversation') hasActiveConversation?: string,
    @Query('customerType') customerType?: string,
    @Query('funnelStage') funnelStage?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.contactManagement.listContacts({
      channel,
      search,
      hasActiveConversation:
        hasActiveConversation !== undefined
          ? hasActiveConversation === 'true'
          : undefined,
      customerType: customerType as any,
      funnelStage: funnelStage as any,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    return {
      success: true,
      data: result.contacts,
      total: result.total,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };
  }

  /**
   * Get single contact with full details
   * GET /admin/contacts/:id
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getContact(@Param('id') id: string, @Request() req: any) {
    const contact = await this.contactManagement.getContactById(id, {
      userId: req.user.id,
      role: req.user.role,
    });

    if (!contact) {
      return {
        success: false,
        error: 'Contact not found',
      };
    }

    return {
      success: true,
      data: contact,
    };
  }

  /**
   * Create new contact
   * POST /admin/contacts
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async createContact(
    @Body()
    body: {
      name?: string;
      phone?: string;
      email?: string;
      type?: ContactType;
      channel?: Channel;
      metadata?: Record<string, any>;
    },
  ) {
    if (!body.name && !body.phone && !body.email) {
      return {
        success: false,
        error: 'At least one of name, phone, or email is required',
      };
    }

    const contact = await this.contactManagement.createContact({
      name: body.name,
      phone: body.phone,
      email: body.email,
      type: body.type,
      channel: body.channel,
      metadata: body.metadata,
    });

    if (contact) {
      this.logger.log(`Contact created: ${contact.id} by admin`);
      return { success: true, data: contact };
    } else {
      return { success: false, error: 'Failed to create contact' };
    }
  }

  /**
   * Update existing contact
   * PUT /admin/contacts/:id
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async updateContact(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      phone?: string;
      email?: string;
      metadata?: Record<string, any>;
      // 2D classification — admin override of the auto-detected values.
      customerType?: string;
      funnelStage?: string;
    },
  ) {
    const contact = await this.contactManagement.updateContact(id, body as any);

    if (contact) {
      this.logger.log(`Contact updated: ${id} by admin`);
      return { success: true, data: contact };
    } else {
      return { success: false, error: 'Failed to update contact' };
    }
  }

  /**
   * Delete contact
   * DELETE /admin/contacts/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteContact(@Param('id') id: string, @Request() req: any) {
    const success = await this.contactManagement.deleteContact(id);

    if (success) {
      this.logger.log(`Contact deleted: ${id} by admin`);
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'contact.delete',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { contactId: id },
      });
      return { success: true, message: 'Contact deleted' };
    } else {
      return {
        success: false,
        error: 'Failed to delete contact (may have active conversations)',
      };
    }
  }

  /**
   * Merge duplicate contacts
   * POST /admin/contacts/:id/merge
   */
  @Post(':id/merge')
  @Roles(UserRole.ADMIN)
  async mergeContacts(
    @Param('id') primaryId: string,
    @Body() body: { duplicateId: string },
    @Request() req: any,
  ) {
    if (!body.duplicateId) {
      return {
        success: false,
        error: 'duplicateId is required',
      };
    }

    const success = await this.contactManagement.mergeContacts(
      primaryId,
      body.duplicateId,
    );

    if (success) {
      this.logger.log(
        `Contacts merged: ${body.duplicateId} → ${primaryId} by admin`,
      );
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'contact.merge',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { primaryId, duplicateId: body.duplicateId },
      });
      return { success: true, message: 'Contacts merged successfully' };
    } else {
      return { success: false, error: 'Failed to merge contacts' };
    }
  }
}
