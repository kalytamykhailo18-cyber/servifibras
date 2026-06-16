// Pull every active ML listing for the Servifibras seller, match each
// to a Product row in the local catalog by seller_sku or seller_custom_field,
// and store the article URL (permalink) on Product.mlPermalink so the
// agent can include a clickable per-product link in ML cross-publication
// redirects.
//
// Marcos's 2026-06-01 ask matched Prometheo's old behaviour: when
// telling a buyer about a different product, drop the actual
// articulo.mercadolibre.com.ar URL straight into the reply.
//
// Strategy:
//   1. `GET /users/{userId}/items/search?status=active` — paginated
//      list of all MLA ids the seller has active. Caps at 50/page,
//      so we walk `scroll_id` until exhausted.
//   2. `GET /items?ids={comma-separated up to 20}` — bulk-fetch each
//      page's items in one round trip (much faster than per-item).
//      Each item carries `seller_custom_field` (the SKU we set when
//      publishing) and `permalink` (the article URL).
//   3. Match item.seller_custom_field → Product.sku (case-insensitive).
//      Write Product.mlPermalink = item.permalink. Skip if no match.
//
// Idempotent — re-running updates the URL if it changed.

import { PrismaClient } from '@prisma/client';

const API = process.env.MERCADOLIBRE_API_URL || 'https://api.mercadolibre.com';

interface MlAttribute {
  id: string;
  value_name?: string | null;
  value_id?: string | null;
  values?: Array<{ name?: string | null; id?: string | null }>;
}
interface MlItem {
  id: string;
  permalink: string;
  status: string;
  seller_custom_field?: string | null;
  title?: string;
  attributes?: MlAttribute[];
}

function extractSellerSku(item: MlItem): string | null {
  // Per /items inspection 2026-06-01: ML stopped writing
  // seller_custom_field for new items and now stores the seller SKU
  // inside the attributes array under id="SELLER_SKU". Fallback chain:
  //   1. attributes[id=SELLER_SKU].value_name (the common path today)
  //   2. seller_custom_field (legacy items)
  //   3. attributes[id=SELLER_SKU].values[0].name
  if (item.attributes) {
    const attr = item.attributes.find((a) => a.id === 'SELLER_SKU');
    if (attr?.value_name) return attr.value_name.trim();
    if (attr?.values?.[0]?.name) return attr.values[0].name!.trim();
  }
  if (item.seller_custom_field) return item.seller_custom_field.trim();
  return null;
}

async function authBearer(prisma: PrismaClient): Promise<{ token: string; userId: string }> {
  const row = await prisma.oAuthCredential.findUnique({ where: { provider: 'mercadolibre' } });
  if (!row?.accessToken || !row.externalId) {
    throw new Error('No mercadolibre OAuth credential row available');
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new Error(`ML token expired at ${row.expiresAt.toISOString()} — refresh first`);
  }
  return { token: row.accessToken, userId: row.externalId };
}

async function listAllItemIds(token: string, userId: string): Promise<string[]> {
  const ids: string[] = [];
  let scrollId: string | null = null;
  let pageNum = 0;
  while (true) {
    pageNum++;
    const url = scrollId
      ? `${API}/users/${userId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `${API}/users/${userId}/items/search?search_type=scan`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`items/search page ${pageNum}: ${res.status} ${await res.text()}`);
    }
    const j: any = await res.json();
    const page: string[] = j.results ?? [];
    ids.push(...page);
    console.log(`  page ${pageNum}: +${page.length} (total ${ids.length})`);
    if (!j.scroll_id || page.length === 0) break;
    scrollId = j.scroll_id;
  }
  return ids;
}

async function fetchItemBatch(token: string, batch: string[]): Promise<MlItem[]> {
  // `attributes` field is required to read SELLER_SKU. Drop the
  // attributes= filter so ML returns the full item — projection support
  // varies by category and we'd rather have a few extra bytes than miss
  // the SKU attribute.
  const url = `${API}/items?ids=${batch.join(',')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`items batch: ${res.status} ${await res.text()}`);
  }
  const j: any = await res.json();
  if (!Array.isArray(j)) return [];
  return j
    .filter((wrap: any) => wrap?.code === 200 || wrap?.body)
    .map((wrap: any) => wrap.body as MlItem)
    .filter((it: any) => it && it.id && it.permalink);
}

(async () => {
  const prisma = new PrismaClient();
  const apply = process.argv.includes('--apply');

  const { token, userId } = await authBearer(prisma);
  console.log(`Authenticated as ML user ${userId}\n`);

  console.log('Phase 1: list all active item ids…');
  const ids = await listAllItemIds(token, userId);
  console.log(`Total item ids: ${ids.length}\n`);

  console.log('Phase 2: bulk-fetch item details (batches of 20)…');
  const items: MlItem[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    try {
      const part = await fetchItemBatch(token, batch);
      items.push(...part);
    } catch (err: any) {
      console.log(`  batch ${i / 20}: ERR ${err.message}`);
    }
  }
  console.log(`Fetched ${items.length} items with permalinks\n`);

  console.log('Phase 3: match items to local catalog by seller_custom_field → Product.sku');
  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  const updates: Array<{ sku: string; permalink: string; mlId: string }> = [];

  for (const it of items) {
    const sku = extractSellerSku(it);
    if (!sku) {
      unmatched++;
      continue;
    }
    const product = await prisma.product.findFirst({
      where: { sku: { equals: sku, mode: 'insensitive' } },
      select: { id: true, sku: true, name: true, mlPermalink: true },
    });
    if (!product) {
      unmatched++;
      continue;
    }
    matched++;
    if (product.mlPermalink !== it.permalink) {
      updates.push({ sku: product.sku, permalink: it.permalink, mlId: it.id });
    }
  }
  console.log(`  matched by SKU:           ${matched}`);
  console.log(`  unmatched (no SKU match): ${unmatched}`);
  console.log(`  pending updates:          ${updates.length}\n`);

  console.log('Sample matches (first 8):');
  for (const u of updates.slice(0, 8)) {
    console.log(`  ${u.sku.padEnd(20)} → ${u.permalink}`);
  }

  if (!apply) {
    console.log('\nDRY RUN — no rows written. Pass --apply to persist.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nApplying updates…');
  for (const u of updates) {
    await prisma.product.updateMany({
      where: { sku: { equals: u.sku, mode: 'insensitive' } },
      data: { mlPermalink: u.permalink },
    });
    updated++;
  }
  console.log(`Updated ${updated} products.`);
  await prisma.$disconnect();
})().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
