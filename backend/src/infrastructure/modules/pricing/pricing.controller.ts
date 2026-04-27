/**
 * INFRASTRUCTURE LAYER - Pricing Controller
 * HTTP endpoints for pricing functionality
 */

import { Controller, Get, Post, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { PricingCalculatorService } from '../../../adapters/pricing/pricing-calculator.service';
import { ExchangeRateService } from '../../../adapters/pricing/exchange-rate.service';
import { ProductPriceService } from '../../../adapters/pricing/product-price.service';

class CalculatePriceDto {
  productName: string;
  quantity: number;
  customerType?: string;
  channel?: string;
}

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingCalculator: PricingCalculatorService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly productPriceService: ProductPriceService,
  ) {}

  @Get('exchange-rate')
  async getExchangeRate() {
    try {
      const rate = await this.exchangeRateService.getBlueRateWithCache();
      return {
        rate: rate.rate,
        source: rate.source,
        timestamp: rate.timestamp,
        isStale: rate.isStale(15),
      };
    } catch (error: any) {
      throw new HttpException(
        'Failed to get exchange rate',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('products')
  async searchProducts(@Query() queryParams: any) {
    const query = queryParams.q;

    if (!query) {
      throw new HttpException('Query parameter "q" is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const products = await this.productPriceService.searchProducts(query);
      return {
        query,
        count: products.length,
        products: products.map(p => ({
          sku: p.sku,
          name: p.name,
          basePriceUSD: p.basePriceUSD,
        })),
      };
    } catch (error: any) {
      throw new HttpException(
        'Failed to search products',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('calculate')
  async calculatePrice(@Body() dto: CalculatePriceDto) {
    if (!dto.productName || !dto.quantity || dto.quantity <= 0) {
      throw new HttpException(
        'productName and quantity (>0) are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const quote = await this.pricingCalculator.calculatePriceByName(
        dto.productName,
        dto.quantity,
        dto.customerType || 'minorista',
        dto.channel || 'whatsapp',
      );

      return {
        product: {
          sku: quote.product.sku,
          name: quote.product.name,
          basePriceUSD: quote.basePriceUSD,
        },
        quantity: quote.quantity,
        exchangeRate: {
          rate: quote.exchangeRate.rate,
          source: quote.exchangeRate.source,
        },
        discounts: {
          volume: quote.volumeDiscount,
          channel: quote.channelDiscount,
        },
        finalPrice: {
          USD: Math.round(quote.finalPriceUSD),
          ARS: Math.round(quote.finalPriceARS),
        },
        formatted: quote.toFormattedString(),
        timestamp: quote.timestamp,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to calculate price',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('health')
  async healthCheck() {
    try {
      // Test exchange rate service
      const rate = await this.exchangeRateService.getBlueRateWithCache();

      // Test product service
      const products = await this.productPriceService.searchProducts('resina');

      return {
        status: 'ok',
        services: {
          exchangeRate: rate ? 'ok' : 'error',
          products: products.length > 0 ? 'ok' : 'warning',
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new HttpException(
        'Pricing service unhealthy',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
