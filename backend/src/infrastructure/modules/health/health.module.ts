import { Module } from '@nestjs/common';
import { HealthService } from '../../../adapters/health/health.service';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
