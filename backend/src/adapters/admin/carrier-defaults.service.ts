/**
 * ADAPTERS LAYER — carrier defaults per (source, zone).
 *
 * Marcos 2026-08-19 (Ustym report Frente D0): la regla real de despacho
 * es que TODO pedido de TiendaNube a CABA/GBA (1/2/3) se lo lleva JYJ
 * por la integración de la tienda. WhatsApp y MercadoLibre no tienen
 * default posible — ahí el pick es obligatorio. Antes de esta capa
 * cada pedido TN caía en "Sin asignar" hasta que el operador picara
 * mensajería a mano; los picks olvidados = paquetes que JYJ se llevó y
 * el sistema no le contó.
 *
 * La config vive en `configurations.carrier_defaults` como JSON:
 *   {
 *     "sourceZoneDefaults": [
 *       { "source": "TIENDANUBE", "zone": "CABA",  "carrier": "JyJ" },
 *       { "source": "TIENDANUBE", "zone": "GBA1",  "carrier": "JyJ" },
 *       { "source": "TIENDANUBE", "zone": "GBA2",  "carrier": "JyJ" },
 *       { "source": "TIENDANUBE", "zone": "GBA3",  "carrier": "JyJ" }
 *     ]
 *   }
 *
 * Es un DEFAULT — el pick del operador (flexCourier) siempre lo pisa.
 * Sólo aplica cuando la mensajería no fue picada y el rawCarrier
 * quedó "Sin asignar" tras la normalización.
 *
 * Env knobs:
 *   CARRIER_DEFAULTS_CACHE_TTL_MS  cache TTL (default 300_000 ms)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const CACHE_TTL_MS_DEFAULT = 5 * 60 * 1000;

interface StoredCarrierDefaults {
  sourceZoneDefaults?: Array<{ source: string; zone: string; carrier: string }>;
}

@Injectable()
export class CarrierDefaultsService {
  private readonly logger = new Logger(CarrierDefaultsService.name);
  private readonly prisma = new PrismaClient();

  private cache: { map: Map<string, string>; loadedAt: number } | null = null;

  private cacheTtlMs(): number {
    const raw = Number(process.env.CARRIER_DEFAULTS_CACHE_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : CACHE_TTL_MS_DEFAULT;
  }

  private normalizeZoneKey(zone: string): string {
    return zone.replace(/\s+/g, '').toUpperCase();
  }

  async getSourceZoneDefaults(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.cache && now - this.cache.loadedAt < this.cacheTtlMs()) {
      return this.cache.map;
    }
    const map = new Map<string, string>();
    try {
      const row = await this.prisma.configuration.findUnique({
        where: { key: 'carrier_defaults' },
      });
      const parsed = (row?.value as unknown as StoredCarrierDefaults | null) ?? null;
      for (const d of parsed?.sourceZoneDefaults ?? []) {
        if (!d.source || !d.zone || !d.carrier) continue;
        const key = `${d.source.toUpperCase()}:${this.normalizeZoneKey(d.zone)}`;
        map.set(key, d.carrier);
      }
    } catch (err: any) {
      this.logger.warn(`carrier_defaults load failed (non-fatal): ${err?.message ?? err}`);
    }
    this.cache = { map, loadedAt: now };
    return map;
  }
}
