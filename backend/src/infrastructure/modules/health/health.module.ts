import { Module } from '@nestjs/common';
import { HealthService } from '../../../adapters/health/health.service';
import { PricingModule } from '../pricing/pricing.module';
import { WhatsappQrModule } from '../whatsapp-qr/whatsapp-qr.module';

@Module({
  imports: [PricingModule, WhatsappQrModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
