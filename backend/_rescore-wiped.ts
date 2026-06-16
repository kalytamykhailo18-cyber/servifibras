import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const r = await fetch('http://localhost:3001/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@servifibras.com', password: 'admin123' }),
  });
  const j: any = await r.json();
  const tk = j.accessToken || j.token;
  if (!tk) { console.log('No token', j); process.exit(1); }

  const candidates = await prisma.conversationScore.findMany({
    where: { rawError: 'claude_returned_null' },
    select: { conversationId: true },
    orderBy: { updatedAt: 'desc' },
  });
  console.log(`Re-scoring ${candidates.length} wiped conversations...`);
  const tally = { stillGrave: 0, cleared: 0, skipped: 0, failed: 0 };
  let i = 0;
  for (const c of candidates) {
    i++;
    try {
      const rr = await fetch(`http://localhost:3001/admin/quality/${c.conversationId}/rescore`, {
        method: 'POST', headers: { Authorization: `Bearer ${tk}` },
      });
      const jj: any = await rr.json();
      const after = jj?.data;
      const newFlag = after?.severeFlag ?? 'unknown';
      const newScore = after?.score;
      let bucket: keyof typeof tally;
      if (newScore === null && newFlag === 'NONE') bucket = 'skipped';
      else if (newFlag !== 'NONE') bucket = 'stillGrave';
      else bucket = 'cleared';
      tally[bucket]++;
      if (i % 10 === 0 || bucket === 'stillGrave') {
        console.log(`  [${i}/${candidates.length}] ${c.conversationId.slice(0,8)}  → ${newFlag}  (score ${newScore})  [${bucket}]`);
      }
    } catch (e: any) {
      tally.failed++;
      console.log(`  ${c.conversationId.slice(0,8)} ERR: ${e.message}`);
    }
  }
  console.log(`\nTally: ${JSON.stringify(tally)}`);
  const graveAfter = await prisma.conversationScore.count({ where: { severeFlag: { not: 'NONE' } } });
  console.log(`Grave alerts AFTER re-score: ${graveAfter}`);
  await prisma.$disconnect();
})();
