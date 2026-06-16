import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const cred = await prisma.oAuthCredential.findUnique({ where: { provider: 'mercadolibre' } });
  if (!cred) return;
  const auth = { headers: { Authorization: `Bearer ${cred.accessToken}` } };
  // Try comma-separated ids
  const r = await fetch('https://api.mercadolibre.com/users?ids=544561980,91126718,93904073', auth);
  console.log(`status=${r.status}`);
  const j = await r.json();
  console.log(JSON.stringify(j).slice(0, 500));
  await prisma.$disconnect();
})();
