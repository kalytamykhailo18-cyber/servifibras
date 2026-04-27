/**
 * INFRASTRUCTURE LAYER - WhatsApp Module
 * Wires WhatsApp service and controller together
 */

import { Module } from '@nestjs/common';
import { WhatsAppService } from '../../../adapters/whatsapp/whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService], // Export for use in other modules later
})
export class WhatsAppModule {}
