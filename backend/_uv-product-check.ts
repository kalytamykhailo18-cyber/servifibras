import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  console.log('=== Products mentioning UV-related terms ===');
  const uvHits = await prisma.product.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: 'UV', mode: 'insensitive' } },
        { name: { contains: 'lámpara', mode: 'insensitive' } },
        { name: { contains: 'fotocurable', mode: 'insensitive' } },
        { description: { contains: 'lámpara UV', mode: 'insensitive' } },
        { description: { contains: 'fotocurable', mode: 'insensitive' } },
        { description: { contains: 'curado UV', mode: 'insensitive' } },
        { description: { contains: 'curado por luz', mode: 'insensitive' } },
      ],
    },
    select: { sku: true, name: true, basePriceArs: true, url: true, description: true },
    take: 30,
  });
  for (const p of uvHits) {
    console.log(`\nSKU: ${p.sku}`);
    console.log(`  name: ${p.name}`);
    console.log(`  price: ARS ${p.basePriceArs ?? '-'}`);
    console.log(`  url:   ${p.url}`);
    if (p.description) {
      const snippet = p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
      const idx = snippet.toLowerCase().indexOf('uv');
      const around = idx > 0 ? snippet.slice(Math.max(0, idx - 80), idx + 200) : snippet.slice(0, 200);
      console.log(`  desc:  ...${around}...`);
    }
  }

  console.log('\n=== URL host distribution (active products) ===');
  const all = await prisma.product.findMany({
    where: { active: true, url: { not: null } },
    select: { url: true },
    take: 1000,
  });
  const hosts: Record<string, number> = {};
  for (const p of all) {
    if (!p.url) continue;
    try {
      const u = new URL(p.url);
      hosts[u.hostname] = (hosts[u.hostname] ?? 0) + 1;
    } catch { /* ignore */ }
  }
  for (const [h, n] of Object.entries(hosts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${h.padEnd(40)} ${n}`);
  }

  await prisma.$disconnect();
})();
