/**
 * INFRASTRUCTURE LAYER - Social Media Module
 * Wires Facebook and Instagram services together
 */

import { Module } from '@nestjs/common';
import { SocialMediaService } from '../../../adapters/social/social-media.service';
import { MetaAdsService } from '../../../adapters/social/meta-ads.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { SocialController } from './social.controller';
import { SocialOAuthController } from './social-oauth.controller';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule], // Import AIModule to access ClaudeService
  controllers: [SocialController, SocialOAuthController],
  providers: [
    SocialMediaService,
    MetaAdsService,
    ConversationHandlerService,
  ],
  exports: [SocialMediaService, MetaAdsService, ConversationHandlerService],
})
export class SocialModule {}
