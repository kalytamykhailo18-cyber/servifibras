/**
 * INFRASTRUCTURE LAYER - Social Media Module
 * Wires Facebook and Instagram services together
 */

import { Module } from '@nestjs/common';
import { SocialMediaService } from '../../../adapters/social/social-media.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { SocialController } from './social.controller';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule], // Import AIModule to access ClaudeService
  controllers: [SocialController],
  providers: [
    SocialMediaService,
    ConversationHandlerService,
  ],
  exports: [SocialMediaService, ConversationHandlerService],
})
export class SocialModule {}
