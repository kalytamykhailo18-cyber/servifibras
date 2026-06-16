/**
 * ADAPTERS LAYER - Product Price Service
 * Fetches product prices from TiendaNube API
 * Can be swapped with real API when credentials available
 */

import { Injectable, Logger } from '@nestjs/common';
import { IProductPriceService } from '../../use-cases/pricing/pricing.interface';
import { Product } from '../../domain/entities/pricing.entity';
import { TiendaNubeAuthResolver } from '../oauth/tiendanube-auth.resolver';

@Injectable()
export class ProductPriceService implements IProductPriceService {
  private readonly logger = new Logger(ProductPriceService.name);
  private readonly apiUrl: string;

  // Mock products for testing (until TiendaNube API is configured)
  private readonly mockProducts: Product[] = [
    new Product('RES-POL-1KG', 'Resina Poliéster 1kg', 15),
    new Product('RES-POL-5KG', 'Resina Poliéster 5kg', 60),
    new Product('RES-POL-20L', 'Resina Poliéster 20 litros', 220),
    new Product('RES-POL-200L', 'Resina Poliéster 200 litros', 2000),
    new Product('RES-EPO-1KG', 'Resina Epoxi 1kg', 25),
    new Product('RES-EPO-5KG', 'Resina Epoxi 5kg', 110),
    new Product('RES-EPO-20KG', 'Resina Epoxi 20kg', 400),
    new Product('FIB-MAT-300', 'Fibra de Vidrio Mat 300g (rollo)', 45),
    new Product('FIB-MAT-450', 'Fibra de Vidrio Mat 450g (rollo)', 60),
    new Product('FIB-ROV-500', 'Tela Roving 500g', 70),
    new Product('SIL-A20-1KG', 'Silicona Shore A20 1kg', 30),
    new Product('SIL-A30-5KG', 'Silicona Shore A30 5kg', 140),
  ];

  constructor(private readonly auth: TiendaNubeAuthResolver) {
    this.apiUrl = process.env.TIENDANUBE_API_URL || 'https://api.tiendanube.com/v1';
    this.logger.log(
      `TiendaNube pricing service initialized (mock fallback ready, ${this.mockProducts.length} products)`,
    );
  }

  async getProductPrice(sku: string): Promise<Product | null> {
    const auth = await this.auth.resolve();
    if (auth) {
      return this.fetchFromTiendaNube(sku, auth);
    }
    return this.getProductFromMock(sku);
  }

  async searchProducts(query: string): Promise<Product[]> {
    const auth = await this.auth.resolve();
    if (auth) {
      return this.searchTiendaNube(query, auth);
    }
    return this.searchMockProducts(query);
  }

  // MOCK DATA METHODS (for testing without API)
  private getProductFromMock(sku: string): Product | null {
    const product = this.mockProducts.find(p => p.sku === sku);
    if (product) {
      this.logger.debug(`[MOCK] Found product: ${product.name} - USD ${product.basePriceUSD}`);
    }
    return product || null;
  }

  private searchMockProducts(query: string): Product[] {
    const normalizedQuery = query.toLowerCase();
    const results = this.mockProducts.filter(p =>
      p.name.toLowerCase().includes(normalizedQuery) ||
      p.sku.toLowerCase().includes(normalizedQuery)
    );
    this.logger.debug(`[MOCK] Search "${query}": ${results.length} results`);
    return results;
  }

  // REAL API METHODS (for when TiendaNube is configured)
  private async fetchFromTiendaNube(
    sku: string,
    auth: { storeId: string; accessToken: string },
  ): Promise<Product | null> {
    try {
      const url = `${this.apiUrl}/${auth.storeId}/products?sku=${sku}`;

      const response = await fetch(url, {
        headers: {
          Authentication: `bearer ${auth.accessToken}`,
          'User-Agent': 'Servifibras AI Platform',
        },
      });

      if (!response.ok) {
        throw new Error(`TiendaNube API error: ${response.status}`);
      }

      const data = await response.json();

      // TiendaNube returns array of products
      if (!data || data.length === 0) {
        return null;
      }

      const productData = data[0];

      // Extract price (TiendaNube stores in store currency, likely ARS)
      // We need to convert to USD or configure products with USD prices
      const priceARS = parseFloat(productData.price);
      // For now, assume a conversion or that prices are already in USD
      const priceUSD = priceARS; // TODO: convert if needed

      return new Product(
        productData.sku || sku,
        productData.name?.es || productData.name,
        priceUSD,
      );
    } catch (error) {
      this.logger.error(`Failed to fetch product from TiendaNube: ${sku}`, error);
      return null;
    }
  }

  private async searchTiendaNube(
    query: string,
    auth: { storeId: string; accessToken: string },
  ): Promise<Product[]> {
    try {
      const url = `${this.apiUrl}/${auth.storeId}/products?q=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        headers: {
          Authentication: `bearer ${auth.accessToken}`,
          'User-Agent': 'Servifibras AI Platform',
        },
      });

      if (!response.ok) {
        throw new Error(`TiendaNube API error: ${response.status}`);
      }

      const data = await response.json();

      return data.map((p: any) => new Product(
        p.sku,
        p.name?.es || p.name,
        parseFloat(p.price), // TODO: convert if needed
      ));
    } catch (error) {
      this.logger.error('Failed to search TiendaNube', error);
      return [];
    }
  }
}
