import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const ml = await prisma.oAuthCredential.findUnique({ where: { provider: 'mercadolibre' } });
  if (!ml) {
    console.log('No mercadolibre OAuth credential row');
  } else {
    console.log(`ML OAuth row present:`);
    console.log(`  externalId: ${ml.externalId}`);
    console.log(`  expiresAt:  ${ml.expiresAt.toISOString()}`);
    console.log(`  metadata:   ${JSON.stringify(ml.metadata)}`);
    const expired = ml.expiresAt.getTime() < Date.now();
    console.log(`  expired?    ${expired}`);
  }
  // Also check env fallback
  console.log(`\nENV: MERCADOLIBRE_USER_ID=${process.env.MERCADOLIBRE_USER_ID ?? '(unset)'}`);
  console.log(`ENV: MERCADOLIBRE_ACCESS_TOKEN length=${(process.env.MERCADOLIBRE_ACCESS_TOKEN ?? '').length}`);

  // Check Product schema for any ML-link field
  const sample = await prisma.product.findFirst({
    where: { active: true, attributes: { not: null as any } },
    select: { sku: true, attributes: true },
  });
  console.log(`\nSample product attributes shape (any ML-link keys?):`);
  console.log(`  ${sample?.sku}: ${JSON.stringify(sample?.attributes).slice(0, 300)}`);

  await prisma.$disconnect();
})();
