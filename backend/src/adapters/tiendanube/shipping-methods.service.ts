/**
 * ADAPTERS LAYER — Shipping methods lookup for the customer-facing agent.
 *
 * Marcos 2026-08-19 (Ustym report Frente C): la agente entra en loop
 * pidiendo el CP tres veces porque el prompt le prohíbe cotizar envíos
 * pero al mismo tiempo la manda a pedir el código postal para
 * "confirmarlo". El fix estructural es una herramienta que devuelva el
 * MÉTODO de envío que aplica según localidad/CP y su plazo, en vez de
 * pretender que el modelo cotice.
 *
 * Nivel 1 de la API de TiendaNube: métodos configurados con zona de
 * cobertura y plazo (sin cost específico). Alcanza para el 90% de los
 * casos porque en AMBA el envío es gratis vía JYJ y en el interior el
 * cliente paga al retirar en la terminal — el número exacto rara vez se
 * necesita.
 *
 * Data source: fila `shipping_methods` de la tabla `configurations`.
 * Se seedeó con los 5 métodos actuales; un cron futuro puede
 * sobrescribirla leyendo `/v1/{store}/shipping_carriers` desde TN.
 *
 * Env knobs:
 *   SHIPPING_METHODS_CACHE_TTL_MS  cache TTL (default 300_000 ms = 5 min)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export type ShippingZone =
  | 'CABA'
  | 'GBA1'
  | 'GBA2'
  | 'GBA3'
  | 'INTERIOR'
  | 'RETIRO';

export interface ShippingMethod {
  /** Nombre visible del método (como aparece en el checkout de TN). */
  name: string;
  /** Zonas donde aplica. Un método puede cubrir varias (ej. GBA1+GBA2+GBA3). */
  zones: ShippingZone[];
  /** Plazo estimado en días, expresado como rango cuando corresponda. */
  deliveryDays: string;
  /** Modo de cobro del envío:
   *  - 'free'        el cliente no paga por el envío
   *  - 'pay_on_arrival'  el cliente abona en la terminal cuando llega
   *  - 'pay_online'  el cliente paga al finalizar la compra en la web
   *  - 'pickup'      retiro en local, sin envío
   */
  costMode: 'free' | 'pay_on_arrival' | 'pay_online' | 'pickup';
  /** Texto libre opcional para casos particulares (p.ej. horario). */
  notes?: string;
}

const CACHE_TTL_MS_DEFAULT = 5 * 60 * 1000;

/** Row shape stored under `configurations.key = 'shipping_methods'`. */
interface StoredShippingMethods {
  methods: ShippingMethod[];
  updatedAt?: string;
}

@Injectable()
export class ShippingMethodsService {
  private readonly logger = new Logger(ShippingMethodsService.name);
  private readonly prisma = new PrismaClient();

  private cache: { methods: ShippingMethod[]; loadedAt: number } | null = null;

  private cacheTtlMs(): number {
    const raw = Number(process.env.SHIPPING_METHODS_CACHE_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : CACHE_TTL_MS_DEFAULT;
  }

  private async load(): Promise<ShippingMethod[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.loadedAt < this.cacheTtlMs()) {
      return this.cache.methods;
    }
    try {
      const row = await this.prisma.configuration.findUnique({
        where: { key: 'shipping_methods' },
      });
      const parsed = (row?.value as unknown as StoredShippingMethods | null) ?? null;
      const methods = parsed?.methods ?? [];
      this.cache = { methods, loadedAt: now };
      return methods;
    } catch (err: any) {
      this.logger.error(`shipping_methods load failed: ${err?.message ?? err}`);
      return this.cache?.methods ?? [];
    }
  }

  /**
   * Resolve the shipping zone for a locality or CP. The lookup goes:
   *   1) CP exact → postal_code_zones
   *   2) locality normalized → postal_code_zones
   *   3) Province substring → CABA fallback (Capital Federal)
   *   4) Everything else → INTERIOR (default fallback so the agent has
   *      SOMETHING to say instead of asking for the CP again).
   */
  async resolveZone(input: string): Promise<ShippingZone | null> {
    if (!input) return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;

    // 1) Bare CP
    const cpMatch = trimmed.match(/\b(\d{4})\b/);
    if (cpMatch) {
      try {
        const hit = await this.prisma.postalCodeZone.findFirst({
          where: { cp: cpMatch[1] },
        });
        if (hit?.zone) return hit.zone as ShippingZone;
      } catch (err: any) {
        this.logger.warn(`postal_code_zones CP lookup failed: ${err?.message ?? err}`);
      }
    }

    // 2) Locality normalized
    const normalized = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length > 0) {
      try {
        const hit = await this.prisma.postalCodeZone.findFirst({
          where: { localityNormalized: normalized },
        });
        if (hit?.zone) return hit.zone as ShippingZone;
      } catch (err: any) {
        this.logger.warn(`postal_code_zones locality lookup failed: ${err?.message ?? err}`);
      }
    }

    // 3) Province → CABA (Capital Federal collapse only)
    if (/(capital federal|caba|c\.a\.b\.a\.?)/i.test(trimmed)) return 'CABA';

    // 4) Default: assume interior — safest fallback for the agent to
    // give a real answer instead of asking for the CP again.
    return 'INTERIOR';
  }

  /**
   * Given a resolved zone, return the applicable methods. The caller
   * (Claude tool) hands this to the model as structured JSON.
   */
  async methodsForZone(zone: ShippingZone): Promise<ShippingMethod[]> {
    const all = await this.load();
    return all.filter((m) => m.zones.includes(zone));
  }

  /**
   * Convenience wrapper for the Claude tool: resolves zone from the
   * customer-provided input and returns the methods that apply.
   * Returns { zone, methods } — never throws, on lookup failure
   * returns { zone: null, methods: [] } so the model can fall back to
   * asking for a CP explicitly.
   */
  async consultForInput(input: string): Promise<{
    zone: ShippingZone | null;
    methods: ShippingMethod[];
  }> {
    const zone = await this.resolveZone(input);
    if (!zone) return { zone: null, methods: [] };
    const methods = await this.methodsForZone(zone);
    return { zone, methods };
  }
}
