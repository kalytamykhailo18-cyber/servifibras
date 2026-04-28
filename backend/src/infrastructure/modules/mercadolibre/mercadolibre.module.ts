/**
 * INFRASTRUCTURE LAYER - MercadoLibre Module
 * Wires up MercadoLibre service, conversation handler, and controller
 */

import { Module } from '@nestjs/common';
import { MercadoLibreController } from './mercadolibre.controller';
import { MercadoLibreService } from '../../../adapters/mercadolibre/mercadolibre.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule],
  controllers: [MercadoLibreController],
  providers: [MercadoLibreService, ConversationHandlerService],
  exports: [MercadoLibreService, ConversationHandlerService],
})
export class MercadoLibreModule {}
