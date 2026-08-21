/**
 * ADAPTERS LAYER — Mayorista keyword + threshold config.
 *
 * Lives behind a `Configuration` row (`type: SYSTEM`, `key:
 * 'lead_detection.mayorista'`) so an admin can edit keywords and the
 * volume threshold from the panel without a redeploy. Falls back to the
 * compiled defaults when the row is missing (fresh installs work
 * out-of-the-box).
 *
 * Cached in-memory with explicit invalidation. The admin controller
 * calls `reload()` after every successful write — the next detector
 * call rebuilds the cache.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigurationType, PrismaClient } from '@prisma/client';

export const DEFAULT_MAYORISTA_KEYWORDS = [
  'mayorista',
  'mayoreo',
  'al por mayor',
  'por mayor',
  'a granel',
  'industrial',
  'distribuidor',
  'distribuidora',
  'revendedor',
  'revender',
  'fábrica',
  'fabrica',
  'lote completo',
];

export const DEFAULT_MAYORISTA_VOLUME_THRESHOLD = 50;

const CONFIG_KEY = 'lead_detection.mayorista';

export interface MayoristaConfig {
  keywords: string[];
  volumeThresholdLitres: number;
  source: 'db' | 'env-default' | 'fallback';
}

@Injectable()
export class LeadDetectionConfigService {
  private readonly logger = new Logger(LeadDetectionConfigService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }
  private cache: MayoristaConfig | null = null;
  private cacheTime = 0;
  private readonly cacheTtlMs =
    Number(process.env.LEAD_DETECTION_CONFIG_CACHE_MS) || 30_000;

  async getMayoristaConfig(): Promise<MayoristaConfig> {
    if (this.cache && Date.now() - this.cacheTime < this.cacheTtlMs) {
      return this.cache;
    }
    return this.loadFromDb();
  }

  /** Force a re-read on the next call, called from the admin controller
   *  after a write so the live detector reflects the change. */
  invalidate(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  /**
   * Persist a new config from the admin panel. Empty arrays / non-positive
   * thresholds fall back to defaults. Returns the resulting effective config.
   */
  async save(input: { keywords?: string[]; volumeThresholdLitres?: number }): Promise<MayoristaConfig> {
    const cleanedKeywords = (input.keywords ?? [])
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0)
      .filter((k, i, arr) => arr.indexOf(k) === i);
    const finalKeywords =
      cleanedKeywords.length > 0 ? cleanedKeywords : DEFAULT_MAYORISTA_KEYWORDS;

    const finalThreshold =
      Number.isFinite(input.volumeThresholdLitres) &&
      Number(input.volumeThresholdLitres) > 0
        ? Number(input.volumeThresholdLitres)
        : DEFAULT_MAYORISTA_VOLUME_THRESHOLD;

    const value = {
      keywords: finalKeywords,
      volumeThresholdLitres: finalThreshold,
    };
    await this.prisma.configuration.upsert({
      where: { key: CONFIG_KEY },
      create: {
        key: CONFIG_KEY,
        type: ConfigurationType.SYSTEM,
        value: value as any,
        description: 'Mayorista detection — keyword list + volume threshold',
        isActive: true,
      },
      update: {
        value: value as any,
        isActive: true,
      },
    });

    this.invalidate();
    this.logger.log(
      `mayorista config updated: ${finalKeywords.length} keywords, threshold ${finalThreshold}L`,
    );
    return { ...value, source: 'db' };
  }

  /**
   * Probe the current effective config against a sample text WITHOUT
   * waiting for a real customer message. Used by the admin form's
   * live preview.
   */
  async probe(text: string): Promise<{ isMayorista: boolean; signals: string[]; confidence: number }> {
    const cfg = await this.getMayoristaConfig();
    return runDetection(text, cfg.keywords, cfg.volumeThresholdLitres);
  }

  private async loadFromDb(): Promise<MayoristaConfig> {
    try {
      const row = await this.prisma.configuration.findUnique({
        where: { key: CONFIG_KEY },
      });
      if (row && row.value && typeof row.value === 'object') {
        const v = row.value as any;
        const keywords = Array.isArray(v.keywords) && v.keywords.length > 0
          ? v.keywords.filter((k: any) => typeof k === 'string' && k.trim().length > 0)
          : DEFAULT_MAYORISTA_KEYWORDS;
        const threshold =
          Number.isFinite(v.volumeThresholdLitres) && v.volumeThresholdLitres > 0
            ? v.volumeThresholdLitres
            : DEFAULT_MAYORISTA_VOLUME_THRESHOLD;
        const cfg: MayoristaConfig = {
          keywords,
          volumeThresholdLitres: threshold,
          source: 'db',
        };
        this.cache = cfg;
        this.cacheTime = Date.now();
        return cfg;
      }
    } catch (err: any) {
      this.logger.error(`config read failed (${err.message}) — falling back to env defaults`);
    }
    // Fallback: env override (legacy MAYORISTA_VOLUME_THRESHOLD) then compiled defaults.
    const envThreshold = Number(process.env.MAYORISTA_VOLUME_THRESHOLD);
    const cfg: MayoristaConfig = {
      keywords: DEFAULT_MAYORISTA_KEYWORDS,
      volumeThresholdLitres:
        Number.isFinite(envThreshold) && envThreshold > 0
          ? envThreshold
          : DEFAULT_MAYORISTA_VOLUME_THRESHOLD,
      source: 'env-default',
    };
    this.cache = cfg;
    this.cacheTime = Date.now();
    return cfg;
  }
}

// ---- Pure detection logic (exported so the detector can reuse it) ----

const UNIT_PATTERNS: Array<{ unit: string; regex: RegExp; toLitres: (n: number) => number }> = [
  { unit: 'L',  regex: /(\d+(?:[.,]\d+)?)\s?(?:l|lt|lts|litros?)\b/giu, toLitres: (n) => n },
  { unit: 'kg', regex: /(\d+(?:[.,]\d+)?)\s?(?:kg|kilos?)\b/giu, toLitres: (n) => n },
  { unit: 't',  regex: /(\d+(?:[.,]\d+)?)\s?(?:t|tn|toneladas?)\b/giu, toLitres: (n) => n * 1000 },
  { unit: 'm',  regex: /(\d+(?:[.,]\d+)?)\s?(?:metros?|mts?)\b/giu, toLitres: (n) => n },
];

export function runDetection(
  text: string,
  keywords: string[],
  thresholdLitres: number,
): { isMayorista: boolean; signals: string[]; confidence: number } {
  if (!text || typeof text !== 'string') {
    return { isMayorista: false, signals: [], confidence: 0 };
  }
  const normalized = text.toLowerCase();
  const signals: string[] = [];

  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k && normalized.includes(k)) signals.push(`keyword:${k}`);
  }

  for (const { unit, regex, toLitres } of UNIT_PATTERNS) {
    const r = new RegExp(regex.source, regex.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(normalized)) !== null) {
      const n = parseFloat(m[1].replace(',', '.'));
      if (!Number.isFinite(n)) continue;
      const litres = toLitres(n);
      if (litres >= thresholdLitres) {
        signals.push(`quantity:${n}${unit}=${litres}L>=${thresholdLitres}`);
      }
    }
  }

  const isMayorista = signals.length > 0;
  let confidence = 0;
  if (signals.some((s) => s.startsWith('keyword:'))) confidence += 0.6;
  if (signals.some((s) => s.startsWith('quantity:'))) confidence += 0.4;
  if (confidence > 1) confidence = 1;
  return { isMayorista, signals, confidence };
}
