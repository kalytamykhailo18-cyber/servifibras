import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './infrastructure/modules/auth/auth.module';
import { AdminModule } from './infrastructure/modules/admin/admin.module';
import { AIModule } from './infrastructure/modules/ai/ai.module';
import { PricingModule } from './infrastructure/modules/pricing/pricing.module';
import { WhatsAppModule } from './infrastructure/modules/whatsapp/whatsapp.module';
// Marcos 2026-06-30: WhatsApp QR (Baileys) — canal alternativo sin
// verificación Meta. Idle hasta WHATSAPP_QR_ENABLED=true en .env.
import { WhatsappQrModule } from './infrastructure/modules/whatsapp-qr/whatsapp-qr.module';
import { SocialModule } from './infrastructure/modules/social/social.module';
import { MercadoLibreModule } from './infrastructure/modules/mercadolibre/mercadolibre.module';
import { WebchatModule } from './infrastructure/modules/webchat/webchat.module';
import { NotificationsModule } from './infrastructure/notifications/notifications.module';
import { LeadDetectionModule } from './infrastructure/modules/lead-detection/lead-detection.module';
import { ConversationsModule } from './infrastructure/modules/conversations/conversations.module';
import { LeadFollowupModule } from './infrastructure/modules/lead-followup/lead-followup.module';
import { ProductCatalogModule } from './infrastructure/modules/product-catalog/product-catalog.module';
import { ChannelGateModule } from './infrastructure/modules/channel-gate/channel-gate.module';
import { AuditModule } from './infrastructure/modules/audit/audit.module';
import { HealthModule } from './infrastructure/modules/health/health.module';
import { MonitoringModule } from './infrastructure/modules/monitoring/monitoring.module';
import { OAuthModule } from './infrastructure/modules/oauth/oauth.module';
import { TiendaNubeModule } from './infrastructure/modules/tiendanube/tiendanube.module';
import { PublicFilesModule } from './infrastructure/modules/public/public-files.module';
import { WidgetModule } from './infrastructure/modules/widget/widget.module';

// Rate-limit baseline read from .env so Marcos can tune without a code
// change. Per-route overrides live next to the controllers (login is
// stricter, webhooks are more permissive).
//
//   THROTTLE_DEFAULT_TTL_SEC — sliding window length (seconds, default 60)
//   THROTTLE_DEFAULT_LIMIT   — max requests per window per IP (default 100)
function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: num('THROTTLE_DEFAULT_TTL_SEC', 60) * 1000,
        limit: num('THROTTLE_DEFAULT_LIMIT', 100),
      },
    ]),
    AuthModule,
    AuditModule,
    MonitoringModule,
    HealthModule,
    OAuthModule,
    NotificationsModule,
    LeadDetectionModule,
    ProductCatalogModule,
    ConversationsModule,
    ChannelGateModule,
    AdminModule,
    AIModule,
    PricingModule,
    WhatsAppModule,
    WhatsappQrModule,
    SocialModule,
    MercadoLibreModule,
    TiendaNubeModule,
    WebchatModule,
    LeadFollowupModule,
    PublicFilesModule,
    WidgetModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply the throttler globally so every endpoint inherits the 'default'
    // bucket. Per-route overrides are added with @Throttle({ name: ... }) at
    // the controller level (auth controller uses 'login', webhook
    // controllers use 'webhook').
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
