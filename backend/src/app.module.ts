import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './infrastructure/modules/auth/auth.module';
import { AdminModule } from './infrastructure/modules/admin/admin.module';
import { AIModule } from './infrastructure/modules/ai/ai.module';
import { PricingModule } from './infrastructure/modules/pricing/pricing.module';
import { WhatsAppModule } from './infrastructure/modules/whatsapp/whatsapp.module';
import { SocialModule } from './infrastructure/modules/social/social.module';
import { MercadoLibreModule } from './infrastructure/modules/mercadolibre/mercadolibre.module';
import { WebchatModule } from './infrastructure/modules/webchat/webchat.module';

@Module({
  imports: [
    AuthModule,
    AdminModule,
    AIModule,
    PricingModule,
    WhatsAppModule,
    SocialModule,
    MercadoLibreModule,
    WebchatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
