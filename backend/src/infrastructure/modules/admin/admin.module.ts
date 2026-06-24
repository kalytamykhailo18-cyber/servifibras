/**
 * INFRASTRUCTURE LAYER - Admin Module
 * Admin dashboard functionality
 */

import { Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConversationsController } from './conversations.controller';
import { ContactsController } from './contacts.controller';
import { KnowledgeController } from './knowledge.controller';
import { AnalyticsController } from './analytics.controller';
import { ConfigurationController } from './configuration.controller';
import { LeadsController } from './leads.controller';
import { OrdersController } from './orders.controller';
import { UsersController } from './users.controller';
import { UploadsController } from './uploads.controller';
import { UploadStorageService } from '../../../adapters/uploads/upload-storage.service';
import { QuickRepliesController } from './quick-replies.controller';
import { QuickReplyService } from '../../../adapters/admin/quick-reply.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignService } from '../../../adapters/admin/campaign.service';
import { ProductsController } from './products.controller';
import { ClaudeBudgetController } from './claude-budget.controller';
import { ReactivationController } from './reactivation.controller';
import { ContactReactivationService } from '../../../adapters/admin/contact-reactivation.service';
import { ContactReactivationCron } from '../../../adapters/admin/contact-reactivation.cron';
import { QuotesController } from './quotes.controller';
import { QuoteService } from '../../../adapters/admin/quote.service';
import { UserManagementService } from '../../../adapters/admin/user-management.service';
import { AuditController } from './audit.controller';
import { AuditModule } from '../audit/audit.module';
import { TiendaNubeSyncController } from './tiendanube-sync.controller';
import { TiendaNubeSyncService } from '../../../adapters/admin/tiendanube-sync.service';
import { TiendaNubeSyncCron } from '../../../adapters/admin/tiendanube-sync.cron';
import { TiendaNubeOrdersSyncService } from '../../../adapters/admin/tiendanube-orders-sync.service';
import { TiendaNubeOrdersSyncCron } from '../../../adapters/admin/tiendanube-orders-sync.cron';
import { MlClaimsSyncCron } from '../../../adapters/admin/ml-claims-sync.cron';
import { VentasUnificadasService } from '../../../adapters/admin/ventas-unificadas.service';
import { MlCompetitorsService } from '../../../adapters/admin/ml-competitors.service';
import { MlCompetitorsController } from './ml-competitors.controller';
import { IntegrationsController } from './integrations.controller';
import { LeadDetectionConfigController } from './lead-detection-config.controller';
import { QualityController } from './quality.controller';
import { ConversationScorerService } from '../../../adapters/quality/conversation-scorer.service';
import { QualityPatternService } from '../../../adapters/quality/quality-pattern.service';
import { DailyDigestController } from './daily-digest.controller';
import { DailyDigestService } from '../../../adapters/admin/daily-digest.service';
import { DailyDigestCron } from '../../../adapters/admin/daily-digest.cron';
import { WeeklyLeadsReportService } from '../../../adapters/admin/weekly-leads-report.service';
import { WeeklyLeadsReportCron } from '../../../adapters/admin/weekly-leads-report.cron';
import { ConversationManagementService } from '../../../adapters/admin/conversation-management.service';
import { ConversationDocumentSenderService } from '../../../adapters/admin/conversation-document-sender.service';
import { FileShareService } from '../../../adapters/files/file-share.service';
import { LowStockAlertService } from '../../../adapters/admin/low-stock-alert.service';
import { ProductCatalogService } from '../../../adapters/admin/product-catalog.service';
import { ProductCatalogModule } from '../product-catalog/product-catalog.module';
import { ReplayController } from './replay.controller';
import { SandboxController } from './sandbox.controller';
import { BackupAlertsController } from './backup-alerts.controller';
import { ContactManagementService } from '../../../adapters/admin/contact-management.service';
import { KnowledgeManagementService } from '../../../adapters/admin/knowledge-management.service';
import { AnalyticsService } from '../../../adapters/admin/analytics.service';
import { ConfigurationService } from '../../../adapters/admin/configuration.service';
import { LeadManagementService } from '../../../adapters/admin/lead-management.service';
import { OrderManagementService } from '../../../adapters/admin/order-management.service';
import { OrderNotificationService } from '../../../adapters/admin/order-notification.service';
import { RoleMetricsService } from '../../../adapters/admin/role-metrics.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AIModule } from '../ai/ai.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WebchatModule } from '../webchat/webchat.module';
import { SocialModule } from '../social/social.module';
import { PricingModule } from '../pricing/pricing.module';
import { LaminadosController } from './laminados.controller';
import { MercadolibreQaController } from './mercadolibre-qa.controller';
import { MercadolibreQaService } from '../../../adapters/admin/mercadolibre-qa.service';
import { PrfvPlacaController } from './prfv-placa.controller';
import { PrfvPlacaService } from '../../../adapters/admin/prfv-placa.service';
import { DailyLogisticaController } from './daily-logistica.controller';
import { DailyLogisticaAggregatorService } from '../../../adapters/admin/daily-logistica-aggregator.service';
import { DailyLogisticaXlsxService } from '../../../adapters/admin/daily-logistica-xlsx.service';
import { LogisticaArmadoService } from '../../../adapters/admin/logistica-armado.service';
import { PublicationFaqController } from './publication-faq.controller';
import { MlBatchQueueController } from './ml-batch-queue.controller';
import { MlBatchQueueCron } from '../../../adapters/ai/ml-batch-queue.cron';
import { WarehouseLocationsService } from '../../../adapters/admin/warehouse-locations.service';
import { VentasUnificadasDriveService } from '../../../adapters/admin/ventas-unificadas-drive.service';
import { DispatchTariffService } from '../../../adapters/admin/dispatch-tariff.service';
import { DispatchTariffsController } from './dispatch-tariffs.controller';
import { PostalCodeZoneService } from '../../../adapters/admin/postal-code-zone.service';
import { PostalCodeZonesController } from './postal-code-zones.controller';
import { TeamPerformanceService } from '../../../adapters/admin/team-performance.service';
import { OperationalResponsibleService } from '../../../adapters/admin/operational-responsible.service';
import { OperationalResponsiblesController } from './operational-responsibles.controller';
import { MlPublicationKnowledgeService } from '../../../adapters/admin/ml-publication-knowledge.service';
import { MlPublicationKnowledgeController } from './ml-publication-knowledge.controller';

@Module({
  imports: [AuthModule, NotificationsModule, AIModule, WhatsAppModule, WebchatModule, SocialModule, AuditModule, ProductCatalogModule, PricingModule, ScheduleModule.forRoot()],
  controllers: [ConversationsController, ContactsController, KnowledgeController, AnalyticsController, ConfigurationController, LeadsController, OrdersController, UsersController, UploadsController, QuickRepliesController, CampaignsController, ProductsController, ClaudeBudgetController, ReactivationController, QuotesController, AuditController, TiendaNubeSyncController, IntegrationsController, LeadDetectionConfigController, LaminadosController, MercadolibreQaController, QualityController, DailyDigestController, ReplayController, SandboxController, BackupAlertsController, PrfvPlacaController, DailyLogisticaController, PublicationFaqController, MlBatchQueueController, MlCompetitorsController, DispatchTariffsController, PostalCodeZonesController, OperationalResponsiblesController, MlPublicationKnowledgeController],
  // ConversationScorerService moved to AIModule providers so every
  // channel handler gets it injected. Keep the import here so the
  // onModuleInit hook below can resolve it.
  // Marcos 2026-06-18: QuickReplyService moved to AIModule (ya
  // expuesto desde ahí) para que ClaudeService y este controller
  // compartan UNA sola instancia. AdminModule lo recibe vía el import
  // de AIModule en la línea de imports.
  providers: [ConversationManagementService, ContactManagementService, KnowledgeManagementService, AnalyticsService, ConfigurationService, LeadManagementService, OrderManagementService, OrderNotificationService, RoleMetricsService, UploadStorageService, FileShareService, CampaignService, ContactReactivationService, ContactReactivationCron, QuoteService, UserManagementService, TiendaNubeSyncService, TiendaNubeSyncCron, QualityPatternService, DailyDigestService, DailyDigestCron, ConversationDocumentSenderService, LowStockAlertService, WeeklyLeadsReportService, WeeklyLeadsReportCron, MercadolibreQaService, PrfvPlacaService, DailyLogisticaAggregatorService, DailyLogisticaXlsxService, LogisticaArmadoService, MlBatchQueueCron, TiendaNubeOrdersSyncService, TiendaNubeOrdersSyncCron, VentasUnificadasService, MlCompetitorsService, WarehouseLocationsService, VentasUnificadasDriveService, DispatchTariffService, PostalCodeZoneService, TeamPerformanceService, MlClaimsSyncCron, OperationalResponsibleService],
  exports: [ConversationManagementService, ContactManagementService, KnowledgeManagementService, AnalyticsService, ConfigurationService, LeadManagementService, OrderManagementService, OrderNotificationService, RoleMetricsService, UploadStorageService, FileShareService, CampaignService, ContactReactivationService, QuoteService, UserManagementService, TiendaNubeSyncService, QualityPatternService, DailyDigestService, ConversationDocumentSenderService, LowStockAlertService, WeeklyLeadsReportService, PrfvPlacaService, DailyLogisticaAggregatorService, DailyLogisticaXlsxService, LogisticaArmadoService],
})
export class AdminModule implements OnModuleInit {
  constructor(
    private readonly conversationManagement: ConversationManagementService,
    private readonly scorer: ConversationScorerService,
    private readonly pattern: QualityPatternService,
    private readonly catalog: ProductCatalogService,
    private readonly lowStock: LowStockAlertService,
  ) {}
  onModuleInit() {
    // Wire the close-trigger AFTER both services exist. Fire-and-forget
    // so closing a conversation doesn't wait on Claude. The scorer also
    // kicks the pattern detector so /admin/quality/team reflects the
    // latest cluster state on the next admin fetch.
    this.conversationManagement.setOnClosed(async (conversationId) => {
      try {
        const r = await this.scorer.evaluateAndPersist(conversationId);
        if (r.success) {
          void this.pattern.detectAndAlert().catch(() => {});
        }
      } catch {
        /* swallowed inside scorer; this is just defense in depth */
      }
    });

    // Live rescore on every operator-sent reply — drives the right-rail
    // quality score panel. Debounced inside the scorer service so a
    // burst of operator messages doesn't trigger N Claude calls.
    this.conversationManagement.setOnReply((conversationId) => {
      this.scorer.scheduleLiveRescore(conversationId);
    });

    // Stock-update hook: any product mutation that touched stockQuantity
    // / threshold / active routes the affected ids through the alert
    // service so ADMIN + LOGISTICA see the warning the moment the row
    // dips below threshold.
    this.catalog.setOnStockUpdated(async (productIds) => {
      try {
        await this.lowStock.checkMany(productIds);
      } catch {
        /* swallowed inside the alert service */
      }
    });
  }
}
