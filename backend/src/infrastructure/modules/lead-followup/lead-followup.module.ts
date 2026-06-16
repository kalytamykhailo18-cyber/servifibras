/**
 * INFRASTRUCTURE LAYER — Lead Follow-up Module.
 *
 * Wires the scheduled QUOTE_SENT nudge service. Pulls in the channel modules
 * because the follow-up dispatcher delegates to each adapter's `sendMessage`.
 */

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LeadFollowupService } from '../../../adapters/lead-detection/lead-followup.service';
import { LeadFollowupCron } from '../../../adapters/lead-detection/lead-followup.cron';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WebchatModule } from '../webchat/webchat.module';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WhatsAppModule,
    WebchatModule,
    SocialModule,
  ],
  providers: [LeadFollowupService, LeadFollowupCron],
  exports: [LeadFollowupService],
})
export class LeadFollowupModule {}
