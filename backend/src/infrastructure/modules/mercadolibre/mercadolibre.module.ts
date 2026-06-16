/**
 * INFRASTRUCTURE LAYER - MercadoLibre Module
 * Wires up MercadoLibre service, conversation handler, and controller
 */

import { Global, Module } from '@nestjs/common';
import { MercadoLibreController } from './mercadolibre.controller';
import { MercadoLibreOAuthController } from './mercadolibre-oauth.controller';
import { MercadoLibreService } from '../../../adapters/mercadolibre/mercadolibre.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { MERCADOLIBRE_SERVICE } from '../../../use-cases/mercadolibre/mercadolibre.token';
import { AIModule } from '../ai/ai.module';

// Global so the `MERCADOLIBRE_SERVICE` token resolves from any
// module's `@Optional() @Inject(MERCADOLIBRE_SERVICE)` — the sandbox
// controller lives in AdminModule and its handler instance comes from
// WebchatModule, neither of which import MercadoLibreModule directly.
// Without @Global the token wouldn't be visible there and the listing
// fetch would silently no-op.
@Global()
@Module({
  imports: [AIModule],
  controllers: [MercadoLibreController, MercadoLibreOAuthController],
  providers: [
    MercadoLibreService,
    // Token-aliased provider so `ConversationHandlerService` can
    // `@Optional() @Inject(MERCADOLIBRE_SERVICE)` without a circular
    // class-symbol import.
    { provide: MERCADOLIBRE_SERVICE, useExisting: MercadoLibreService },
    ConversationHandlerService,
  ],
  exports: [MercadoLibreService, MERCADOLIBRE_SERVICE, ConversationHandlerService],
})
export class MercadoLibreModule {}
