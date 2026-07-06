/**
 * Marcos 2026-06-30: módulo del canal WhatsApp QR. Reusa el
 * ConversationHandler de WhatsAppModule para no duplicar la lógica
 * de agente (las dos rutas inbound — Meta Cloud y QR — terminan
 * llamando handleWhatsAppMessage). El service se autoarranca via
 * OnModuleInit cuando WHATSAPP_QR_ENABLED=true; sino queda idle.
 */

import { forwardRef, Module } from '@nestjs/common';
import { WhatsappQrService } from '../../../adapters/whatsapp-qr/whatsapp-qr.service';
import { WhatsappQrController, WhatsappQrTestController } from './whatsapp-qr.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AuthModule } from '../auth/auth.module';
import { UploadStorageService } from '../../../adapters/uploads/upload-storage.service';

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
  controllers: [WhatsappQrController, WhatsappQrTestController],
  // Marcos 2026-07-06: UploadStorageService lo provee este módulo para
  // el download de media WA. Es stateless — el mismo servicio también
  // vive en WhatsAppModule; instanciarlo dos veces no genera problemas
  // (no hay estado compartido, solo escribe a UPLOADS_DIR).
  providers: [WhatsappQrService, UploadStorageService],
  exports: [WhatsappQrService],
})
export class WhatsappQrModule {}
