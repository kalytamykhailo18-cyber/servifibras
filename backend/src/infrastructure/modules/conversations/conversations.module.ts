/**
 * INFRASTRUCTURE LAYER — Conversation-side detectors and helpers shared
 * across all 4 inbound channels (WhatsApp, Social, MercadoLibre, Webchat).
 *
 * Currently wires:
 *   - IOrderStatusIntent (heuristic) — keyword detection for "where is my
 *     order?" style questions.
 *   - OrderStatusReplyService — composes the deterministic Spanish reply.
 *
 * `@Global()` mirrors LeadDetectionModule so each channel module doesn't
 * have to re-import this manually.
 */

import { Global, Module } from '@nestjs/common';
import { KeywordOrderStatusIntent } from '../../../adapters/conversations/keyword-order-status-intent';
import { OrderStatusReplyService } from '../../../adapters/conversations/order-status-reply.service';
import { FaqPreAiService } from '../../../adapters/conversations/faq-pre-ai.service';
import { ProductLookupShortcutService } from '../../../adapters/conversations/product-lookup-shortcut.service';
import { ORDER_STATUS_INTENT } from '../../../use-cases/conversations/order-status-intent.interface';

@Global()
@Module({
  providers: [
    KeywordOrderStatusIntent,
    {
      provide: ORDER_STATUS_INTENT,
      useExisting: KeywordOrderStatusIntent,
    },
    OrderStatusReplyService,
    FaqPreAiService,
    ProductLookupShortcutService,
  ],
  exports: [
    ORDER_STATUS_INTENT,
    OrderStatusReplyService,
    FaqPreAiService,
    ProductLookupShortcutService,
  ],
})
export class ConversationsModule {}
