/**
 * INFRASTRUCTURE LAYER - Pricing Module
 * Wires all pricing services together
 */

import { Module } from '@nestjs/common';
import { ExchangeRateService } from '../../../adapters/pricing/exchange-rate.service';
import { ProductPriceService } from '../../../adapters/pricing/product-price.service';
import { PricingCalculatorService } from '../../../adapters/pricing/pricing-calculator.service';
import { LaminadosCotizadorService } from '../../../adapters/pricing/laminados-cotizador.service';
import { LaminadosPriceConfigService } from '../../../adapters/pricing/laminados-price-config.service';
import { PricingController } from './pricing.controller';

@Module({
  controllers: [PricingController],
  providers: [
    ExchangeRateService,
    ProductPriceService,
    PricingCalculatorService,
    LaminadosPriceConfigService,
    LaminadosCotizadorService,
  ],
  exports: [
    PricingCalculatorService,
    ExchangeRateService,
    LaminadosCotizadorService,
    LaminadosPriceConfigService,
  ],
})
export class PricingModule {}
