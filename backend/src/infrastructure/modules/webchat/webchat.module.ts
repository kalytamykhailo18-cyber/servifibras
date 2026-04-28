/**
 * INFRASTRUCTURE LAYER - TiendaNube Webchat Module
 */

import { Module } from '@nestjs/common';
import { WebchatController } from './webchat.controller';
import { WebchatService } from '../../../adapters/webchat/webchat.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule],
  controllers: [WebchatController],
  providers: [WebchatService, ConversationHandlerService],
  exports: [WebchatService, ConversationHandlerService],
})
export class WebchatModule {}
