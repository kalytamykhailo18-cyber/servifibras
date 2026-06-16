import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const skus = ['1M2-300', '1905', 'RED100A-RED100B', 'REP1000+500B'];
  for (const sku of skus) {
    const p = await prisma.product.findFirst({
      where: { sku: { equals: sku, mode: 'insensitive' } },
      select: { sku: true, name: true, mlPermalink: true, url: true },
    });
    if (!p) {
      console.log(`[${sku}] NOT FOUND`);
      continue;
    }
    console.log(`[${p.sku}] ${p.name.slice(0, 60)}`);
    console.log(`  mlPermalink: ${p.mlPermalink ?? '(null)'}`);
    console.log(`  url:         ${p.url}`);
  }
  await prisma.$disconnect();
})();
