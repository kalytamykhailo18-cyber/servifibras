import { PrismaClient } from '@prisma/client';
import { ProductCatalogService } from './src/adapters/admin/product-catalog.service';

(async () => {
  const svc = new ProductCatalogService();
  const result = await svc.searchForAI('rodillo', 20);
  console.log(result);
  console.log('\n---ALSO TRYING "rodillo resina"---');
  const r2 = await svc.searchForAI('rodillo resina', 20);
  console.log(r2);
})();
