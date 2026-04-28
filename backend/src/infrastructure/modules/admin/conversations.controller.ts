/**
 * INFRASTRUCTURE LAYER - Admin Conversations Controller
 * Manages conversation viewing, assignment, and manual takeover
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ConversationManagementService } from '../../../adapters/admin/conversation-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { Channel, ConversationStatus } from '@prisma/client';

@Controller('admin/conversations')
@UseGuards(AuthGuard, RolesGuard)
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationManagement: ConversationManagementService,
  ) {}

  /**
   * Get conversation statistics
   * GET /admin/conversations/stats/summary
   */
  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getStatistics() {
    const stats = await this.conversationManagement.getStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * List all conversations with filters
   * GET /admin/conversations
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async listConversations(
    @Query('channel') channel?: Channel,
    @Query('status') status?: ConversationStatus,
    @Query('search') search?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.conversationManagement.listConversations({
      channel,
      status,
      search,
      assignedToUserId: assignedTo,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    return {
      success: true,
      data: result.conversations,
      total: result.total,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };
  }

  /**
   * Get single conversation with full history
   * GET /admin/conversations/:id
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getConversation(@Param('id') id: string) {
    const conversation = await this.conversationManagement.getConversationById(id);

    if (!conversation) {
      return {
        success: false,
        error: 'Conversation not found',
      };
    }

    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * Assign conversation to user (manual takeover)
   * POST /admin/conversations/:id/assign
   */
  @Post(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async assignConversation(
    @Param('id') id: string,
    @Body() body: { userId: string },
    @Request() req: any,
  ) {
    const success = await this.conversationManagement.assignConversation(
      id,
      body.userId,
    );

    if (success) {
      this.logger.log(
        `Conversation ${id} assigned to user ${body.userId} by ${req.user.email}`,
      );
      return { success: true, message: 'Conversation assigned' };
    } else {
      return { success: false, error: 'Failed to assign conversation' };
    }
  }

  /**
   * Take over conversation (assign to self)
   * POST /admin/conversations/:id/takeover
   */
  @Post(':id/takeover')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async takeoverConversation(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;

    const success = await this.conversationManagement.assignConversation(id, userId);

    if (success) {
      this.logger.log(`Conversation ${id} taken over by ${req.user.email}`);
      return { success: true, message: 'Conversation taken over' };
    } else {
      return { success: false, error: 'Failed to take over conversation' };
    }
  }

  /**
   * Update conversation status
   * PUT /admin/conversations/:id/status
   */
  @Put(':id/status')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: ConversationStatus },
  ) {
    const success = await this.conversationManagement.updateConversationStatus(
      id,
      body.status,
    );

    if (success) {
      return { success: true, message: 'Status updated' };
    } else {
      return { success: false, error: 'Failed to update status' };
    }
  }

  /**
   * Send manual message (human agent reply)
   * POST /admin/conversations/:id/message
   */
  @Post(':id/message')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { content: string },
    @Request() req: any,
  ) {
    const userId = req.user.id;

    const success = await this.conversationManagement.sendManualMessage(
      id,
      userId,
      body.content,
    );

    if (success) {
      this.logger.log(
        `Manual message sent in conversation ${id} by ${req.user.email}`,
      );
      return { success: true, message: 'Message sent' };
    } else {
      return { success: false, error: 'Failed to send message' };
    }
  }
}
