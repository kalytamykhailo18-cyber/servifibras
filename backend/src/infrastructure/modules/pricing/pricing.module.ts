/**
 * INFRASTRUCTURE LAYER - Pricing Module
 * Wires all pricing services together
 */

import { Module } from '@nestjs/common';
import { ExchangeRateService } from '../../../adapters/pricing/exchange-rate.service';
import { ProductPriceService } from '../../../adapters/pricing/product-price.service';
import { PricingCalculatorService } from '../../../adapters/pricing/pricing-calculator.service';
import { PricingController } from './pricing.controller';

@Module({
  controllers: [PricingController],
  providers: [
    ExchangeRateService,
    ProductPriceService,
    PricingCalculatorService,
  ],
  exports: [
    PricingCalculatorService, // Export for use in other modules (AI, etc)
  ],
})
export class PricingModule {}
