import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  const marcos = await prisma.user.findFirst({
    where: { email: 'marcos@servifibras.com' },
    select: { id: true, name: true, email: true },
  });
  if (!marcos) { console.log('Marcos not found'); await prisma.$disconnect(); return; }
  console.log(`User: ${marcos.name} <${marcos.email}>`);

  // Full timeline for Marcos — everything ever
  const all = await prisma.accessLog.findMany({
    where: { userId: marcos.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { createdAt: true, action: true, ip: true, userAgent: true, metadata: true },
  });
  console.log(`\nMarcos events (most recent ${all.length}):\n`);
  for (const l of all) {
    const m = l.metadata ? JSON.stringify(l.metadata).slice(0, 120) : '';
    const ua = (l.userAgent || '').replace(/Mozilla\/[\d.]+\s*\(/, '').slice(0, 35);
    console.log(`  ${l.createdAt.toISOString()}  ${l.action.padEnd(40)} ip=${(l.ip ?? '-').padEnd(16)} ${ua}  ${m}`);
  }

  // Action histogram
  const h: Record<string, number> = {};
  for (const l of all) h[l.action] = (h[l.action] ?? 0) + 1;
  console.log('\nAction histogram (all-time, top 200):');
  for (const [k, v] of Object.entries(h).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }

  // First + last event by IP
  console.log('\nBy IP:');
  const byIp: Record<string, { first: Date; last: Date; n: number }> = {};
  for (const l of all) {
    const ip = l.ip ?? '-';
    if (!byIp[ip]) byIp[ip] = { first: l.createdAt, last: l.createdAt, n: 0 };
    byIp[ip].n++;
    if (l.createdAt < byIp[ip].first) byIp[ip].first = l.createdAt;
    if (l.createdAt > byIp[ip].last) byIp[ip].last = l.createdAt;
  }
  for (const [ip, s] of Object.entries(byIp)) {
    console.log(`  ${ip.padEnd(20)} n=${s.n.toString().padStart(3)} first=${s.first.toISOString()} last=${s.last.toISOString()}`);
  }

  // Conversations he interacted with via the panel
  const messages = await prisma.message.findMany({
    where: { authorId: marcos.id },
    orderBy: { timestamp: 'desc' },
    take: 30,
    select: { timestamp: true, conversationId: true, sender: true, isFromAI: true },
  });
  console.log(`\nMessages Marcos authored (most recent ${messages.length}):`);
  for (const m of messages) {
    console.log(`  ${m.timestamp.toISOString()}  conv=${m.conversationId.slice(0,8)} sender=${m.sender} ai=${m.isFromAI}`);
  }

  await prisma.$disconnect();
})();
