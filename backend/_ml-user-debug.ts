import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const cred = await prisma.oAuthCredential.findUnique({ where: { provider: 'mercadolibre' } });
  if (!cred?.accessToken) { console.log('no ML token'); return; }
  const API = 'https://api.mercadolibre.com';

  // User IDs from Marcos's screenshots
  const userIds = ['544561980', '91126718', '93904073', '316570907', '64762733'];
  for (const uid of userIds) {
    const r = await fetch(`${API}/users/${uid}`, {
      headers: { Authorization: `Bearer ${cred.accessToken}` },
    });
    if (!r.ok) {
      console.log(`${uid}: HTTP ${r.status}`);
      continue;
    }
    const j: any = await r.json();
    console.log(`${uid.padEnd(10)} → nickname: ${j.nickname ?? '(null)'}, status: ${j.status?.site_status ?? '-'}`);
  }

  // Also fetch a recent question to inspect from-object shape
  const userId = cred.externalId;
  const r0 = await fetch(`${API}/questions/search?seller_id=${userId}&status=ANSWERED&limit=3`, {
    headers: { Authorization: `Bearer ${cred.accessToken}` },
  });
  const j0: any = await r0.json();
  console.log(`\nSample answered questions (${j0.questions?.length ?? 0}):`);
  for (const q of (j0.questions ?? []).slice(0, 3)) {
    console.log(`  q.id=${q.id}  from=${JSON.stringify(q.from)}`);
  }
  await prisma.$disconnect();
})();
