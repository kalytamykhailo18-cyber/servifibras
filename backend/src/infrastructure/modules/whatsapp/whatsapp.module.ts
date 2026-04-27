/**
 * INFRASTRUCTURE LAYER - WhatsApp Module
 * Wires WhatsApp service and controller together
 */

import { Module } from '@nestjs/common';
import { WhatsAppService } from '../../../adapters/whatsapp/whatsapp.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { WhatsAppController } from './whatsapp.controller';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule], // Import AIModule to access ClaudeService
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    ConversationHandlerService,
  ],
  exports: [WhatsAppService, ConversationHandlerService],
})
export class WhatsAppModule {}
