/**
 * ADAPTERS LAYER - Exchange Rate Service
 * Fetches dólar blue rate from bluelytics.com.ar API
 */

import { Injectable, Logger } from '@nestjs/common';
import { IExchangeRateService } from '../../use-cases/pricing/pricing.interface';
import { ExchangeRate } from '../../domain/entities/pricing.entity';

@Injectable()
export class ExchangeRateService implements IExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private readonly apiUrl: string;
  private cachedRate: ExchangeRate | null = null;

  constructor() {
    // ✅ RULE 1: All config from .env, never hardcoded
    this.apiUrl = process.env.BLUELYTICS_API_URL || 'https://api.bluelytics.com.ar/v2/latest';
    this.logger.log(`Exchange Rate Service initialized: ${this.apiUrl}`);
  }

  async getCurrentBlueRate(): Promise<ExchangeRate> {
    try {
      this.logger.debug('Fetching current blue dollar rate...');

      const response = await fetch(this.apiUrl);

      if (!response.ok) {
        throw new Error(`Bluelytics API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Bluelytics API response structure:
      // { blue: { value_avg: 1000, value_sell: 1005, value_buy: 995 }, ... }
      const blueRate = data.blue?.value_avg || data.blue?.value_sell;

      if (!blueRate) {
        throw new Error('Blue rate not found in API response');
      }

      const exchangeRate = new ExchangeRate(
        blueRate,
        'blue',
        new Date(),
      );

      this.logger.log(`✅ Blue dollar rate: ${blueRate} ARS/USD`);

      return exchangeRate;
    } catch (error) {
      this.logger.error('Failed to fetch blue dollar rate', error);

      // Fallback: if we have cached rate, use it even if stale
      if (this.cachedRate) {
        this.logger.warn('Using stale cached rate as fallback');
        return this.cachedRate;
      }

      // Last resort: hardcoded fallback (should rarely happen)
      this.logger.error('No cached rate available, using fallback: 1000 ARS/USD');
      return new ExchangeRate(1000, 'fallback', new Date());
    }
  }

  /**
   * Snapshot of the in-memory cache for the health endpoint. Pure read —
   * never triggers a fetch, never blocks. Returns null fields when the cache
   * is empty (service has just started and no rate has been fetched yet).
   */
  getCacheInfo(): { rate: number | null; source: string | null; ageMs: number | null; cachedAt: string | null } {
    if (!this.cachedRate) {
      return { rate: null, source: null, ageMs: null, cachedAt: null };
    }
    return {
      rate: this.cachedRate.rate,
      source: this.cachedRate.source,
      ageMs: Date.now() - this.cachedRate.timestamp.getTime(),
      cachedAt: this.cachedRate.timestamp.toISOString(),
    };
  }

  async getBlueRateWithCache(maxAgeMinutes: number = 15): Promise<ExchangeRate> {
    // ✅ RULE 1: Cache duration from .env
    const cacheMinutes = parseInt(process.env.EXCHANGE_RATE_CACHE_MINUTES || '15');

    // Check if cached rate is still fresh
    if (this.cachedRate && !this.cachedRate.isStale(cacheMinutes)) {
      const age = Math.round((Date.now() - this.cachedRate.timestamp.getTime()) / 60000);
      this.logger.debug(`Using cached blue rate (${age} min old): ${this.cachedRate.rate}`);
      return this.cachedRate;
    }

    // Cache miss or stale - fetch new rate
    const freshRate = await this.getCurrentBlueRate();
    this.cachedRate = freshRate;
    return freshRate;
  }
}
