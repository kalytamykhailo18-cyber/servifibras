import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AIModule } from './infrastructure/modules/ai/ai.module';
import { PricingModule } from './infrastructure/modules/pricing/pricing.module';
import { WhatsAppModule } from './infrastructure/modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    AIModule,
    PricingModule,
    WhatsAppModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
