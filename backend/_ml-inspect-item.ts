import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const row = await prisma.oAuthCredential.findUnique({ where: { provider: 'mercadolibre' } });
  if (!row) { console.log('no ML cred'); return; }

  const API = 'https://api.mercadolibre.com';
  // Pick one active item id
  const r0 = await fetch(`${API}/users/${row.externalId}/items/search?search_type=scan&limit=3`, {
    headers: { Authorization: `Bearer ${row.accessToken}` },
  });
  const j0: any = await r0.json();
  const ids: string[] = j0.results.slice(0, 3);
  console.log(`Inspecting items: ${ids.join(', ')}\n`);

  for (const id of ids) {
    const r = await fetch(`${API}/items/${id}`, {
      headers: { Authorization: `Bearer ${row.accessToken}` },
    });
    const j: any = await r.json();
    console.log(`--- ${id} ---`);
    console.log(`  title:                  ${j.title}`);
    console.log(`  permalink:              ${j.permalink}`);
    console.log(`  seller_custom_field:    ${j.seller_custom_field ?? '(null)'}`);
    console.log(`  seller_sku:             ${j.seller_sku ?? '(null)'}`);
    // attributes array may have SKU as an attribute
    if (Array.isArray(j.attributes)) {
      const skuAttr = j.attributes.find((a: any) =>
        ['SELLER_SKU', 'SKU', 'PART_NUMBER', 'CUSTOM_FIELD'].includes(a.id),
      );
      if (skuAttr) {
        console.log(`  attribute ${skuAttr.id}:   ${skuAttr.value_name ?? skuAttr.value_id ?? JSON.stringify(skuAttr.values)}`);
      }
      // dump all attribute IDs for quick scan
      console.log(`  ALL attribute IDs:      ${j.attributes.map((a: any) => a.id).join(', ')}`);
    }
    // variations may have their own SKUs
    if (Array.isArray(j.variations) && j.variations.length > 0) {
      console.log(`  variations: ${j.variations.length}`);
      const v0 = j.variations[0];
      console.log(`    var[0].seller_custom_field: ${v0.seller_custom_field ?? '(null)'}`);
      console.log(`    var[0].attributes: ${(v0.attributes ?? []).map((a: any) => a.id).join(', ')}`);
    }
    // description?
    console.log(`  category_id: ${j.category_id}`);
    console.log();
  }

  await prisma.$disconnect();
})();
