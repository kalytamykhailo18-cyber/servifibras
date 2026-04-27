/**
 * DOMAIN LAYER - Pricing Entities
 * Pure business logic for price calculations
 */

export class Product {
  constructor(
    public readonly sku: string,
    public readonly name: string,
    public readonly basePriceUSD: number,
  ) {}
}

export class ExchangeRate {
  constructor(
    public readonly rate: number, // ARS per 1 USD
    public readonly source: string, // e.g., "blue", "official"
    public readonly timestamp: Date,
  ) {}

  isStale(maxAgeMinutes: number = 60): boolean {
    const ageMs = Date.now() - this.timestamp.getTime();
    const ageMinutes = ageMs / (1000 * 60);
    return ageMinutes > maxAgeMinutes;
  }
}

export enum CustomerType {
  MINORISTA = 'MINORISTA',
  MAYORISTA = 'MAYORISTA',
  EMPRENDEDOR = 'EMPRENDEDOR',
  INDUSTRIAL = 'INDUSTRIAL',
}

export enum SalesChannel {
  WHATSAPP = 'WHATSAPP',
  MERCADOLIBRE = 'MERCADOLIBRE',
  TIENDANUBE = 'TIENDANUBE',
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
}

export class PriceCalculationInput {
  constructor(
    public readonly product: Product,
    public readonly quantity: number,
    public readonly customerType: CustomerType,
    public readonly channel: SalesChannel,
  ) {}
}

export class PriceQuote {
  constructor(
    public readonly product: Product,
    public readonly quantity: number,
    public readonly basePriceUSD: number,
    public readonly exchangeRate: ExchangeRate,
    public readonly volumeDiscount: number, // percentage (0-100)
    public readonly channelDiscount: number, // percentage (0-100)
    public readonly finalPriceARS: number,
    public readonly finalPriceUSD: number,
    public readonly timestamp: Date,
  ) {}

  toFormattedString(): string {
    const totalARS = Math.round(this.finalPriceARS);
    const totalUSD = Math.round(this.finalPriceUSD);

    let str = `${this.product.name} x${this.quantity}: $${totalARS.toLocaleString('es-AR')} ARS`;
    str += ` (aprox. USD ${totalUSD.toLocaleString('es-AR')} al cambio de hoy)`;

    if (this.volumeDiscount > 0 || this.channelDiscount > 0) {
      str += `. Incluye descuento`;
      if (this.volumeDiscount > 0) str += ` por volumen (${this.volumeDiscount}%)`;
      if (this.channelDiscount > 0) str += ` canal (${this.channelDiscount}%)`;
    }

    return str;
  }
}
