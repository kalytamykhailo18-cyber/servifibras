/**
 * INFRASTRUCTURE LAYER — Product Catalog Module.
 *
 * Standalone so both AdminModule (CRUD endpoints) and AIModule (AI-context
 * builder) can import it without a circular dependency.
 */

import { Global, Module } from '@nestjs/common';
import { ProductCatalogService } from '../../../adapters/admin/product-catalog.service';

@Global()
@Module({
  providers: [ProductCatalogService],
  exports: [ProductCatalogService],
})
export class ProductCatalogModule {}
