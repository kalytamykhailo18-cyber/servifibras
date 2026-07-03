/**
 * INFRASTRUCTURE LAYER - WhatsApp Module
 * Wires WhatsApp service and controller together
 */

import { forwardRef, Module } from '@nestjs/common';
import { WhatsAppService } from '../../../adapters/whatsapp/whatsapp.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { UploadStorageService } from '../../../adapters/uploads/upload-storage.service';
import { WhatsAppController } from './whatsapp.controller';
import { AIModule } from '../ai/ai.module';
import { WhatsappQrModule } from '../whatsapp-qr/whatsapp-qr.module';

@Module({
  // Marcos 2026-07-03: importamos WhatsappQrModule para que
  // WhatsAppService pueda pedir WhatsappQrService via @Optional() y
  // rutear outbound por Baileys cuando el QR está enganchado (en vez
  // de Meta Cloud, que no tenemos verificado). Circular: WhatsappQrModule
  // también importa WhatsAppModule para consumir ConversationHandler,
  // por eso los dos lados usan forwardRef.
  imports: [AIModule, forwardRef(() => WhatsappQrModule)],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    ConversationHandlerService,
    UploadStorageService,
  ],
  exports: [WhatsAppService, ConversationHandlerService],
})
export class WhatsAppModule {}
