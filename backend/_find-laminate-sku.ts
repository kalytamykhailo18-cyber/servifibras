import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const rows = await prisma.product.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: 'lámina', mode: 'insensitive' } },
        { name: { contains: 'lamina', mode: 'insensitive' } },
        { name: { contains: 'plancha', mode: 'insensitive' } },
        { name: { contains: 'revestimiento', mode: 'insensitive' } },
      ],
    },
    select: { sku: true, name: true },
    take: 5,
  });
  for (const r of rows) console.log(`${r.sku}\t${r.name.slice(0, 80)}`);
  await prisma.$disconnect();
})();
