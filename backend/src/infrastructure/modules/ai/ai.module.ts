/**
 * INFRASTRUCTURE LAYER - NestJS Module
 * Wires everything together using dependency injection
 */

import { Module } from '@nestjs/common';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { ClaudeBudgetService } from '../../../adapters/ai/claude-budget.service';
import { ConversationStyleService } from '../../../adapters/ai/conversation-style.service';
import { CustomerContextService } from '../../../adapters/ai/customer-context.service';
import { ConversationSummaryService } from '../../../adapters/ai/conversation-summary.service';
import { ConversationScorerService } from '../../../adapters/quality/conversation-scorer.service';
import { KnowledgeRepository } from '../../../adapters/repositories/knowledge.repository';
import { PublicationFaqService } from '../../../adapters/admin/publication-faq.service';
import { QuickReplyService } from '../../../adapters/admin/quick-reply.service';
import { MlBatchQueueService } from '../../../adapters/ai/ml-batch-queue.service';
import { HistoryCompressionService } from '../../../adapters/ai/history-compression.service';
import { AIController } from './ai.controller';
import { PricingModule } from '../pricing/pricing.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  // PricingModule for the calculator, NotificationsModule for the
  // socket gateway that the summary + scorer broadcast through.
  imports: [PricingModule, NotificationsModule],
  controllers: [AIController],
  providers: [
    KnowledgeRepository,
    ClaudeService,
    ClaudeBudgetService,
    ConversationStyleService,
    CustomerContextService,
    ConversationSummaryService,
    // Scorer lives here so every channel module that imports AIModule
    // (whatsapp, social, webchat, mercadolibre) gets it injected via
    // the optional @Inject on ConversationHandlerService — enabling
    // mid-conversation rescoring on every AI reply across all channels.
    ConversationScorerService,
    // Publication FAQ shortcut (Bloque E item 3) — lives here so the
    // ML inbound handler can inject it for findMatch() AND the admin
    // controller in AdminModule (which imports AIModule) can inject it
    // for the CRUD endpoints. Single shared instance across both paths.
    PublicationFaqService,
    // Marcos 2026-06-18: librería global de respuestas rápidas. Vive
    // acá para que ClaudeService la pueda inyectar como bloque
    // "FORMULACIONES APROBADAS" en el system prompt; el CRUD admin la
    // recibe desde AdminModule donde también está provided.
    QuickReplyService,
    // ML batch queue (Bloque E item 4). Same wiring — injected by the
    // ML inbound handler to enqueue inbound questions, and by the
    // admin controller / cron for dispatch/poll/visibility.
    MlBatchQueueService,
    // History compression (Bloque E item 5). Reads the existing
    // ConversationSummaryService output and renders a cached system
    // block so long WA/webchat threads don't keep re-uploading their
    // full message tail to Claude.
    HistoryCompressionService,
  ],
  exports: [
    ClaudeService,
    ClaudeBudgetService,
    ConversationSummaryService,
    ConversationScorerService,
    PublicationFaqService,
    QuickReplyService,
    MlBatchQueueService,
    HistoryCompressionService,
  ],
})
export class AIModule {}
