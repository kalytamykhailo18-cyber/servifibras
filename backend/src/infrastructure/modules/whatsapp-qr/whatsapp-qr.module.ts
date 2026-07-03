/**
 * Marcos 2026-06-30: módulo del canal WhatsApp QR. Reusa el
 * ConversationHandler de WhatsAppModule para no duplicar la lógica
 * de agente (las dos rutas inbound — Meta Cloud y QR — terminan
 * llamando handleWhatsAppMessage). El service se autoarranca via
 * OnModuleInit cuando WHATSAPP_QR_ENABLED=true; sino queda idle.
 */

import { forwardRef, Module } from '@nestjs/common';
import { WhatsappQrService } from '../../../adapters/whatsapp-qr/whatsapp-qr.service';
import { WhatsappQrController } from './whatsapp-qr.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // Reusamos el ConversationHandler de WA para que inbound QR pase
    // por exactamente el mismo pipeline (agente / handoff / scoring /
    // saveMessage / metrics) que inbound Meta Cloud. forwardRef porque
    // WhatsAppModule ahora también nos importa a nosotros (outbound
    // bridge Meta→Baileys, 2026-07-03).
    forwardRef(() => WhatsAppModule),
    // AuthGuard + RolesGuard del controller.
    AuthModule,
  ],
  controllers: [WhatsappQrController],
  providers: [WhatsappQrService],
  exports: [WhatsappQrService],
})
export class WhatsappQrModule {}
