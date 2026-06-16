import { ProductCatalogService } from './src/adapters/admin/product-catalog.service';
(async () => {
  const svc = new ProductCatalogService();
  const r = await svc.searchForAI('MAT 300', 5);
  console.log(r);
})();
