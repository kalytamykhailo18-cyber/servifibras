import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const cred = await prisma.oAuthCredential.findUnique({ where: { provider: 'mercadolibre' } });
  if (!cred?.accessToken) { console.log('no ML token'); return; }
  const API = 'https://api.mercadolibre.com';
  const auth = { headers: { Authorization: `Bearer ${cred.accessToken}` } };

  console.log('=== Testing multiple ML question endpoints for nickname inline ===\n');

  // 1. /questions/search?seller_id (what I tested before)
  console.log('1) /questions/search?seller_id (default)');
  let r = await fetch(`${API}/questions/search?seller_id=${cred.externalId}&status=ANSWERED&limit=2`, auth);
  let j: any = await r.json();
  for (const q of j.questions ?? []) {
    console.log(`   id=${q.id}  from=${JSON.stringify(q.from)}  status=${q.status}`);
  }

  // 2. with api_version=4
  console.log('\n2) /questions/search?api_version=4');
  r = await fetch(`${API}/questions/search?api_version=4&seller_id=${cred.externalId}&status=ANSWERED&limit=2`, auth);
  j = await r.json();
  for (const q of j.questions ?? []) {
    console.log(`   id=${q.id}  from=${JSON.stringify(q.from)}`);
  }

  // 3. /my/received_questions/search
  console.log('\n3) /my/received_questions/search');
  r = await fetch(`${API}/my/received_questions/search?status=ANSWERED&limit=2`, auth);
  j = await r.json();
  for (const q of j.questions ?? []) {
    console.log(`   id=${q.id}  from=${JSON.stringify(q.from)}`);
  }

  // 4. fetch a single question by id with embedded user
  console.log('\n4) /questions/{id} singular (what fetchQuestionDetails uses)');
  const oneId = j.questions?.[0]?.id;
  if (oneId) {
    r = await fetch(`${API}/questions/${oneId}`, auth);
    const single: any = await r.json();
    console.log(`   id=${single.id}  from=${JSON.stringify(single.from)}`);
    console.log(`   ALL KEYS: ${Object.keys(single).join(', ')}`);
  }

  // 5. try webhook-shape — look at sample webhook URL with embedded
  // user.nickname (some webhook docs imply nickname in body)
  console.log('\n5) Webhook-style endpoint with embedded user (if exists)');
  if (oneId) {
    r = await fetch(`${API}/questions/${oneId}?include=user`, auth);
    const inc: any = await r.json();
    console.log(`   from=${JSON.stringify(inc.from)}  caller_id=${inc.caller_id ?? '-'}`);
  }

  // 6. orders endpoint sometimes embeds nickname for buyer post-purchase
  console.log('\n6) /orders/search recent — does buyer carry nickname?');
  r = await fetch(`${API}/orders/search?seller=${cred.externalId}&limit=2`, auth);
  j = await r.json();
  for (const o of j.results ?? []) {
    console.log(`   order=${o.id}  buyer=${JSON.stringify(o.buyer)}`);
  }

  await prisma.$disconnect();
})();
