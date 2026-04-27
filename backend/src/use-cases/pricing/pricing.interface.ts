/**
 * USE CASES LAYER - Pricing Service Interface
 * Defines what pricing operations are available
 */

import {
  Product,
  ExchangeRate,
  PriceCalculationInput,
  PriceQuote,
} from '../../domain/entities/pricing.entity';

export interface IExchangeRateService {
  /**
   * Get current blue dollar exchange rate
   * @returns Exchange rate (ARS per USD)
   */
  getCurrentBlueRate(): Promise<ExchangeRate>;

  /**
   * Get cached rate if fresh, otherwise fetch new
   * @param maxAgeMinutes Maximum age of cached rate
   */
  getBlueRateWithCache(maxAgeMinutes?: number): Promise<ExchangeRate>;
}

export interface IProductPriceService {
  /**
   * Get product base price from TiendaNube
   * @param sku Product SKU
   * @returns Product with base price in USD
   */
  getProductPrice(sku: string): Promise<Product | null>;

  /**
   * Search products by name
   * @param query Search query
   * @returns List of matching products
   */
  searchProducts(query: string): Promise<Product[]>;
}

export interface IPricingCalculator {
  /**
   * Calculate final price for a product
   * @param input Calculation parameters
   * @returns Price quote with all discounts applied
   */
  calculatePrice(input: PriceCalculationInput): Promise<PriceQuote>;

  /**
   * Calculate price with automatic product lookup
   * @param productName Product name to search
   * @param quantity Quantity
   * @param customerType Customer type
   * @param channel Sales channel
   * @returns Price quote
   */
  calculatePriceByName(
    productName: string,
    quantity: number,
    customerType: string,
    channel: string,
  ): Promise<PriceQuote>;
}
