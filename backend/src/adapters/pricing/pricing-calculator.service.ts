/**
 * ADAPTERS LAYER - Pricing Calculator
 * Calculates final prices with discounts and exchange rates
 */

import { Injectable, Logger } from '@nestjs/common';
import { IPricingCalculator } from '../../use-cases/pricing/pricing.interface';
import {
  Product,
  PriceCalculationInput,
  PriceQuote,
  CustomerType,
  SalesChannel,
} from '../../domain/entities/pricing.entity';
import { ExchangeRateService } from './exchange-rate.service';
import { ProductPriceService } from './product-price.service';

@Injectable()
export class PricingCalculatorService implements IPricingCalculator {
  private readonly logger = new Logger(PricingCalculatorService.name);

  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly productPriceService: ProductPriceService,
  ) {
    this.logger.log('Pricing Calculator initialized');
  }

  async calculatePrice(input: PriceCalculationInput): Promise<PriceQuote> {
    // Get current exchange rate
    const exchangeRate = await this.exchangeRateService.getBlueRateWithCache();

    // Calculate volume discount
    const volumeDiscount = this.calculateVolumeDiscount(
      input.product,
      input.quantity,
    );

    // Calculate channel discount (if mayorista)
    const channelDiscount = this.calculateChannelDiscount(input.customerType);

    // Calculate base price in USD
    const baseTotalUSD = input.product.basePriceUSD * input.quantity;

    // Apply volume discount
    const afterVolumeUSD = baseTotalUSD * (1 - volumeDiscount / 100);

    // Apply channel discount
    const finalPriceUSD = afterVolumeUSD * (1 - channelDiscount / 100);

    // Convert to ARS
    const finalPriceARS = finalPriceUSD * exchangeRate.rate;

    const quote = new PriceQuote(
      input.product,
      input.quantity,
      input.product.basePriceUSD,
      exchangeRate,
      volumeDiscount,
      channelDiscount,
      finalPriceARS,
      finalPriceUSD,
      new Date(),
    );

    this.logger.debug(
      `Quote: ${input.product.name} x${input.quantity} = USD ${Math.round(finalPriceUSD)} / ARS ${Math.round(finalPriceARS)}`,
    );

    return quote;
  }

  async calculatePriceByName(
    productName: string,
    quantity: number,
    customerType: string,
    channel: string,
  ): Promise<PriceQuote> {
    // Search for product
    const products = await this.productPriceService.searchProducts(productName);

    if (products.length === 0) {
      throw new Error(`Producto no encontrado: ${productName}`);
    }

    // Use first match (or implement fuzzy matching)
    const product = products[0];

    // Parse enums
    const custType = this.parseCustomerType(customerType);
    const salesChannel = this.parseSalesChannel(channel);

    // Calculate
    const input = new PriceCalculationInput(
      product,
      quantity,
      custType,
      salesChannel,
    );

    return this.calculatePrice(input);
  }

  // DISCOUNT LOGIC (pure business rules)
  private calculateVolumeDiscount(product: Product, quantity: number): number {
    // ✅ RULE 1: Discount rates from .env
    const discount20L = parseInt(process.env.VOLUME_DISCOUNT_20L || '5');
    const discount100L = parseInt(process.env.VOLUME_DISCOUNT_100L || '10');
    const discount200L = parseInt(process.env.VOLUME_DISCOUNT_200L || '15');

    // Extract volume from product name (heuristic)
    const name = product.name.toLowerCase();

    // Check if product is liquid (litros/liters). Match a *number-followed-by-unit*
    // boundary so we don't false-positive on names that just happen to contain
    // the letter "l" (e.g. "industrial", "letra"). Patterns covered:
    //   "5L", "5 L", "5L ", "5 litros", "5 lt", "200ltrs"
    const isLiquid = /\b\d+\s*(l|lt|ltrs?|litros?)\b/i.test(name);

    if (!isLiquid) {
      // For non-liquid products, use quantity-based discounts
      if (quantity >= 10) return discount200L;
      if (quantity >= 5) return discount100L;
      if (quantity >= 3) return discount20L;
      return 0;
    }

    // For liquid products, check volume in name
    const match = name.match(/(\d+)\s*(l|litro)/i);
    if (match) {
      const volumePerUnit = parseInt(match[1]);
      const totalVolume = volumePerUnit * quantity;

      if (totalVolume >= 200) return discount200L;
      if (totalVolume >= 100) return discount100L;
      if (totalVolume >= 20) return discount20L;
    }

    return 0;
  }

  private calculateChannelDiscount(customerType: CustomerType): number {
    // ✅ RULE 1: Mayorista discount from .env
    const mayoristaDiscount = parseInt(process.env.MAYORISTA_EXTRA_DISCOUNT || '10');

    if (customerType === CustomerType.MAYORISTA) {
      return mayoristaDiscount;
    }

    // Industrial customers might also get discounts
    if (customerType === CustomerType.INDUSTRIAL) {
      return mayoristaDiscount / 2; // Half of mayorista
    }

    return 0;
  }

  // PARSING HELPERS
  private parseCustomerType(type: string): CustomerType {
    const normalized = type.toUpperCase();
    if (normalized.includes('MAYOR')) return CustomerType.MAYORISTA;
    if (normalized.includes('INDUS')) return CustomerType.INDUSTRIAL;
    if (normalized.includes('EMPREN')) return CustomerType.EMPRENDEDOR;
    return CustomerType.MINORISTA;
  }

  private parseSalesChannel(channel: string): SalesChannel {
    const normalized = channel.toUpperCase();
    if (normalized.includes('WHATS')) return SalesChannel.WHATSAPP;
    if (normalized.includes('MERCADO')) return SalesChannel.MERCADOLIBRE;
    if (normalized.includes('FACEBOOK') || normalized.includes('FB')) return SalesChannel.FACEBOOK;
    if (normalized.includes('INSTAGRAM') || normalized.includes('IG')) return SalesChannel.INSTAGRAM;
    if (normalized.includes('TIENDA')) return SalesChannel.TIENDANUBE;
    return SalesChannel.WHATSAPP; // default
  }
}
