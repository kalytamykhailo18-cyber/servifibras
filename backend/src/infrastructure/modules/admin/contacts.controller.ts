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
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ContactManagementService } from '../../../adapters/admin/contact-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { Channel } from '@prisma/client';

@Controller('admin/contacts')
@UseGuards(AuthGuard, RolesGuard)
export class ContactsController {
  private readonly logger = new Logger(ContactsController.name);

  constructor(
    private readonly contactManagement: ContactManagementService,
  ) {}

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
  async getContact(@Param('id') id: string) {
    const contact = await this.contactManagement.getContactById(id);

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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async createContact(
    @Body()
    body: {
      name: string;
      phone?: string;
      email?: string;
      channel: Channel;
      metadata?: Record<string, any>;
    },
  ) {
    if (!body.name || !body.channel) {
      return {
        success: false,
        error: 'Name and channel are required',
      };
    }

    const contact = await this.contactManagement.createContact({
      name: body.name,
      phone: body.phone,
      email: body.email,
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async updateContact(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      phone?: string;
      email?: string;
      metadata?: Record<string, any>;
    },
  ) {
    const contact = await this.contactManagement.updateContact(id, body);

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
  async deleteContact(@Param('id') id: string) {
    const success = await this.contactManagement.deleteContact(id);

    if (success) {
      this.logger.log(`Contact deleted: ${id} by admin`);
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
      return { success: true, message: 'Contacts merged successfully' };
    } else {
      return { success: false, error: 'Failed to merge contacts' };
    }
  }
}
