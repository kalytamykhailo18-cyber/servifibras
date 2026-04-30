/**
 * INFRASTRUCTURE LAYER - Admin Module
 * Admin dashboard functionality
 */

import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ContactsController } from './contacts.controller';
import { KnowledgeController } from './knowledge.controller';
import { AnalyticsController } from './analytics.controller';
import { ConfigurationController } from './configuration.controller';
import { LeadsController } from './leads.controller';
import { OrdersController } from './orders.controller';
import { UsersController } from './users.controller';
import { ConversationManagementService } from '../../../adapters/admin/conversation-management.service';
import { ContactManagementService } from '../../../adapters/admin/contact-management.service';
import { KnowledgeManagementService } from '../../../adapters/admin/knowledge-management.service';
import { AnalyticsService } from '../../../adapters/admin/analytics.service';
import { ConfigurationService } from '../../../adapters/admin/configuration.service';
import { LeadManagementService } from '../../../adapters/admin/lead-management.service';
import { OrderManagementService } from '../../../adapters/admin/order-management.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ConversationsController, ContactsController, KnowledgeController, AnalyticsController, ConfigurationController, LeadsController, OrdersController, UsersController],
  providers: [ConversationManagementService, ContactManagementService, KnowledgeManagementService, AnalyticsService, ConfigurationService, LeadManagementService, OrderManagementService],
  exports: [ConversationManagementService, ContactManagementService, KnowledgeManagementService, AnalyticsService, ConfigurationService, LeadManagementService, OrderManagementService],
})
export class AdminModule {}
