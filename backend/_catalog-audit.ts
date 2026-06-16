import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  const queries = [
    'Porcelanato',
    'Alto Tránsito',
    'Alto Transito',
    'alto-transito',
    'piso',
    'Rodillo',
    'Almohadilla',
    'MAT 300',
    'Resina Epoxi Pisos',
  ];

  for (const q of queries) {
    const rows = await prisma.product.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q.toUpperCase() } },
          { url: { contains: q.toLowerCase().replace(/\s+/g, '') } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 10,
      select: { sku: true, name: true, basePriceArs: true, baseUnit: true, url: true },
    });
    console.log(`\n=== query: "${q}" (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`  ${r.sku.padEnd(18)} ${r.name.padEnd(60)} ARS ${r.basePriceArs ?? '-'}  ${r.baseUnit}`);
      if (r.url) console.log(`  → ${r.url}`);
    }
  }

  await prisma.$disconnect();
})();
