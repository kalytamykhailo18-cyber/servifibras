/**
 * Demo seeder — additive, idempotent, non-destructive.
 *
 * Builds a realistic, populated state for `dev.servifibras.com` so when
 * Marcos AnyDesks in, every page looks alive instead of empty. Approximates
 * the volume Marcos reported running on prometheo.ai (~650 conversations /
 * ~6,000 messages over 7 days, 88% WhatsApp).
 *
 * Idempotency
 * -----------
 * Every row this seeder creates is tagged with `metadata.demoSeed = true`.
 * Re-running deletes our previous demo rows first, then re-creates. It will
 * never touch rows you created by hand or that the real platform created.
 *
 * Run
 * ---
 *   cd /home/servifibras/backend
 *   npx ts-node --transpile-only prisma/seed-demo.ts
 */

import {
  PrismaClient,
  Channel,
  ConversationStatus,
  ContentType,
  ContactType,
  CustomerType,
  FunnelStage,
  LeadStatus,
  MessageSender,
  OrderStatus,
  QuoteStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

// === Knobs (env-overridable so a tester can scale up/down without editing) ==
const N_CONTACTS = Number(process.env.DEMO_CONTACTS) || 80;
const N_CONVERSATIONS = Number(process.env.DEMO_CONVERSATIONS) || 120;
const MSG_MEAN = Number(process.env.DEMO_MSG_PER_CONV) || 8; // ratio matches reported 9.3 ± noise
const N_DAYS_BACK = Number(process.env.DEMO_DAYS_BACK) || 7;

// === Argentine profile data ================================================
const FIRST_NAMES = [
  'Juan', 'María', 'Federico', 'Lucía', 'Diego', 'Sofía', 'Martín', 'Camila',
  'Lautaro', 'Valentina', 'Gonzalo', 'Florencia', 'Ezequiel', 'Agustina',
  'Matías', 'Julieta', 'Nicolás', 'Carolina', 'Sebastián', 'Romina',
  'Hernán', 'Natalia', 'Pablo', 'Daniela', 'Cristian', 'Marcela',
  'Rodrigo', 'Victoria', 'Leandro', 'Mariana', 'Joaquín', 'Belén',
];
const LAST_NAMES = [
  'González', 'Rodríguez', 'Pérez', 'López', 'García', 'Fernández',
  'Martínez', 'Sánchez', 'Romero', 'Sosa', 'Gómez', 'Díaz',
  'Acosta', 'Suárez', 'Benítez', 'Álvarez', 'Ruiz', 'Torres',
  'Ramírez', 'Castro', 'Molina', 'Herrera', 'Silva', 'Aguirre',
];
const LOCALITIES = ['CABA', 'La Plata', 'Córdoba', 'Rosario', 'Mendoza', 'Mar del Plata', 'San Juan', 'Tucumán'];
const AREA_CODES = ['11', '221', '351', '341', '261', '223', '264', '381'];

// === Servifibras product universe ==========================================
const PRODUCTS_BY_TYPE: Record<CustomerType, Array<{ name: string; price: number }>> = {
  ARTESANO: [
    { name: 'Resina cristal 1L para artesanías', price: 8500 },
    { name: 'Pigmento perlado set x6', price: 4200 },
    { name: 'Silicona moldeo platino 500g', price: 12800 },
    { name: 'Kit principiante resina UV', price: 18900 },
  ],
  EMPRENDEDOR: [
    { name: 'Kit completo para emprendedores', price: 38000 },
    { name: 'Resina cristal 5L', price: 38500 },
    { name: 'Fibra de vidrio MAT 300g x10m', price: 28400 },
    { name: 'Pack moldes silicona industrial', price: 52000 },
  ],
  MAYORISTA: [
    { name: 'Resina poliéster 200L', price: 320000 },
    { name: 'Fibra de vidrio rollo 50kg', price: 185000 },
    { name: 'Silicona industrial 25kg', price: 215000 },
    { name: 'Catalizador MEK-P 25L', price: 78000 },
  ],
  INDUSTRIAL: [
    { name: 'Resina vinil-éster tonelada', price: 1450000 },
    { name: 'Fibra de vidrio rovinguer 500kg', price: 980000 },
    { name: 'Resina epoxi industrial 200kg', price: 740000 },
    { name: 'Kit laminación serie a granel', price: 1200000 },
  ],
  PRFV_LAMINADOS: [
    { name: 'Resina ortoftálica 200L', price: 285000 },
    { name: 'Mat 450g rollo industrial', price: 192000 },
    { name: 'Gelcoat blanco 25kg', price: 140000 },
    { name: 'Kit laminación pileta PRFV', price: 480000 },
  ],
  PROVEEDOR: [
    { name: 'Lote mixto distribución', price: 580000 },
    { name: 'Pack reventa estándar', price: 320000 },
    { name: 'Catálogo distribuidor mayorista', price: 750000 },
  ],
};

// === Channel mix (matches Marcos's reported ~88% WhatsApp share) ============
const CHANNEL_WEIGHTS: Array<{ ch: Channel; w: number }> = [
  { ch: Channel.WHATSAPP, w: 0.88 },
  { ch: Channel.MERCADOLIBRE, w: 0.06 },
  { ch: Channel.FACEBOOK, w: 0.03 },
  { ch: Channel.INSTAGRAM, w: 0.02 },
  { ch: Channel.TIENDANUBE_WEBCHAT, w: 0.01 },
];

// === Customer-type mix — slanted toward the segments that drive revenue ====
const CUSTOMER_TYPE_WEIGHTS: Array<{ t: CustomerType; w: number }> = [
  { t: CustomerType.EMPRENDEDOR, w: 0.32 },
  { t: CustomerType.ARTESANO, w: 0.24 },
  { t: CustomerType.MAYORISTA, w: 0.18 },
  { t: CustomerType.PRFV_LAMINADOS, w: 0.12 },
  { t: CustomerType.INDUSTRIAL, w: 0.08 },
  { t: CustomerType.PROVEEDOR, w: 0.06 },
];

// === Helpers ================================================================
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted<T>(items: Array<{ w: number } & Record<string, any>>, key: string): T {
  const total = items.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return (it as any)[key]; }
  return (items[items.length - 1] as any)[key];
}
function dateBack(days: number): Date {
  // Bias toward "recent" — exponential decay so today/yesterday have more
  // activity than 6 days ago. Matches a real inbox shape better than uniform.
  const u = Math.random();
  const t = -Math.log(1 - u * (1 - Math.exp(-2))) / 2; // 0..1, biased to small
  const ms = t * days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}
function phone(): string { return `+549${pick(AREA_CODES)}${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`; }
function name(): string { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }
function cuit(): string {
  const head = ['20', '23', '27', '30', '33'][Math.floor(Math.random() * 5)];
  const middle = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  const check = String(Math.floor(Math.random() * 10));
  return `${head}-${middle}-${check}`;
}
function poisson(mean: number): number {
  // Knuth's tiny inversion. Good for mean < 30.
  const L = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// === Realistic message templates by direction + channel/funnel stage ========
const CUSTOMER_OPENERS = [
  'Hola, quería consultar precios.',
  'Buenas, necesito cotización para un proyecto.',
  'Hola! ¿Tienen stock de resina poliéster?',
  'Buenos días, quería saber si manejan venta mayorista.',
  'Hola, soy artesana y arranco con resina, qué me recomiendan?',
  'Buenas, mando consulta para industria.',
  'Necesito 200 litros de resina, soy distribuidor.',
  'Hola, cómo manejan envíos al interior?',
  'Buenas tardes, los precios incluyen IVA?',
  'Hola, vi un producto en TiendaNube, lo tienen disponible?',
];
const AI_REPLIES = [
  'Hola! Buenas, gracias por escribirnos. Sí, manejamos resina poliéster en presentaciones de 1L, 5L, 25L y 200L. ¿Qué cantidad necesitás?',
  'Hola! Para mayoristas tenemos lista de precios diferenciada. ¿Me pasás CUIT y volumen aproximado para armarte una cotización?',
  'Buenas, sí trabajamos con envíos a todo el país por OCA, Andreani o transporte propio según volumen. ¿De qué localidad?',
  'Sí, todos los precios son finales con IVA incluido. ¿Te paso el catálogo?',
  'Te derivo con un asesor del equipo comercial para que te arme una cotización formal.',
  'Hola! Para emprendedores tenemos un kit de inicio que incluye resina, catalizador, pigmentos y moldes. ¿Te interesa?',
];
const STAFF_REPLIES = [
  'Hola Juan, te paso el detalle. Resina poliéster 25L: $52.500 + IVA. Tiempo de entrega 48hs en CABA. ¿Confirmamos?',
  'Buenas, ya armamos la cotización formal. Te la paso por mail también.',
  'Confirmado el envío para mañana. Te llega entre 14 y 18hs.',
  'Hola, ya recibimos el pago. Procesamos hoy y mañana sale el despacho.',
  'Te comparto factura A. Cualquier consulta avisame.',
];

// === Cleanup of previous demo rows ==========================================
async function clearPreviousDemo(): Promise<void> {
  const tag = { path: ['demoSeed'], equals: true } as any;
  // Order: messages (cascade via conversation), then conversations, then
  // leads/orders/quotes, then contacts. Quote/Order/Lead don't have a
  // metadata column — but they reference contacts that DO, so deleting
  // demo contacts cascades nothing (relations are non-cascading), so we
  // delete child rows first.
  const demoContacts = await prisma.contact.findMany({
    where: { metadata: tag }, select: { id: true },
  });
  const ids = demoContacts.map((c) => c.id);
  if (ids.length === 0) return;

  await prisma.message.deleteMany({ where: { conversation: { contactId: { in: ids } } } });
  await prisma.internalNote.deleteMany({ where: { conversation: { contactId: { in: ids } } } });
  await prisma.conversation.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.order.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  console.log(`  cleared ${ids.length} previous demo contacts and their dependents`);
}

// === Build contacts =========================================================
async function seedContacts(): Promise<Array<{ id: string; type: CustomerType; createdAt: Date; name: string }>> {
  const out: Array<{ id: string; type: CustomerType; createdAt: Date; name: string }> = [];
  for (let i = 0; i < N_CONTACTS; i++) {
    const customerType = pickWeighted<CustomerType>(CUSTOMER_TYPE_WEIGHTS as any, 't');
    const fullName = name();
    const createdAt = dateBack(N_DAYS_BACK);
    // funnel-stage skew: most are CONSULTA, some COTIZADO, fewer COMPRADOR/etc.
    const funnelStage = pickWeighted<FunnelStage>([
      { s: FunnelStage.CONSULTA, w: 0.40 } as any,
      { s: FunnelStage.COTIZADO, w: 0.25 } as any,
      { s: FunnelStage.NO_CONCRETO, w: 0.13 } as any,
      { s: FunnelStage.COMPRADOR, w: 0.12 } as any,
      { s: FunnelStage.FRECUENTE, w: 0.06 } as any,
      { s: FunnelStage.REACTIVAR, w: 0.04 } as any,
    ] as any, 's');

    const c = await prisma.contact.create({
      data: {
        name: fullName,
        phone: phone(),
        email: Math.random() < 0.3 ? `${fullName.toLowerCase().replace(/\s+/g, '.')}@gmail.com` : null,
        type: customerType === CustomerType.MAYORISTA ? ContactType.MAYORISTA
            : customerType === CustomerType.INDUSTRIAL ? ContactType.INDUSTRIAL
            : customerType === CustomerType.EMPRENDEDOR ? ContactType.EMPRENDEDOR
            : ContactType.MINORISTA,
        customerType,
        funnelStage,
        channel: pickWeighted<Channel>(CHANNEL_WEIGHTS as any, 'ch'),
        // Marcos 2026-07-09: demoSeed contacts stay out of every dashboard
        // aggregator. Before this flag the 80 demo contacts + their orders
        // + leads leaked into "pedidos a despachar" / "cotizaciones sin
        // respuesta" as if they were real.
        isSandbox: true,
        metadata: { demoSeed: true, locality: pick(LOCALITIES) },
        createdAt,
      },
    });
    out.push({ id: c.id, type: customerType, createdAt, name: fullName });
  }
  console.log(`  created ${out.length} contacts (skewed: ${CUSTOMER_TYPE_WEIGHTS.map(w => `${w.t} ${(w.w*100).toFixed(0)}%`).join(', ')})`);
  return out;
}

// === Build conversations + messages =========================================
async function seedConversationsAndMessages(contacts: Array<{ id: string; type: CustomerType; createdAt: Date }>): Promise<number> {
  let totalMessages = 0;
  for (let i = 0; i < N_CONVERSATIONS; i++) {
    const c = pick(contacts);
    const channel = pickWeighted<Channel>(CHANNEL_WEIGHTS as any, 'ch');
    const startedAt = new Date(Math.max(c.createdAt.getTime(), dateBack(N_DAYS_BACK).getTime()));

    // 12% of conversations escalated, 8% AI paused — realistic for SMB inbox
    const needsHuman = Math.random() < 0.12;
    const aiPaused = Math.random() < 0.08;

    // 25% closed (resolved), the rest active or waiting
    const status: ConversationStatus = Math.random() < 0.25
      ? ConversationStatus.CLOSED
      : Math.random() < 0.7
        ? ConversationStatus.ACTIVE
        : ConversationStatus.WAITING;

    const conv = await prisma.conversation.create({
      data: {
        contactId: c.id,
        channel,
        status,
        isSandbox: true,
        isUnread: status === ConversationStatus.ACTIVE && Math.random() < 0.4,
        needsHumanAttention: needsHuman,
        escalatedAt: needsHuman ? new Date(startedAt.getTime() + 5 * 60 * 1000) : null,
        aiPaused,
        aiPausedAt: aiPaused ? new Date(startedAt.getTime() + 10 * 60 * 1000) : null,
        metadata: { demoSeed: true },
        createdAt: startedAt,
        lastMessageAt: startedAt,
      },
    });

    // Build a back-and-forth thread. ~8 messages mean, with poisson jitter.
    const nMessages = Math.max(2, poisson(MSG_MEAN));
    let cursor = startedAt.getTime();
    let lastBody = '';
    for (let m = 0; m < nMessages; m++) {
      // Even = customer/AI exchange, occasional staff message late in the thread
      let sender: MessageSender;
      let isFromAI = false;
      let body: string;
      if (m === 0) {
        sender = MessageSender.CUSTOMER; body = pick(CUSTOMER_OPENERS);
      } else if (m % 2 === 1) {
        // Reply turn
        if (!aiPaused && Math.random() < 0.7) { sender = MessageSender.AI; isFromAI = true; body = pick(AI_REPLIES); }
        else {
          // Staff handles it. Pick role roughly by funnel-stage.
          sender = c.type === CustomerType.MAYORISTA || c.type === CustomerType.INDUSTRIAL
            ? MessageSender.FRANCO
            : MessageSender.BRENDA;
          body = pick(STAFF_REPLIES);
        }
      } else {
        sender = MessageSender.CUSTOMER;
        body = m < 4
          ? '¿Y para 50 litros qué precio me hacés?'
          : Math.random() < 0.5 ? 'Listo, lo pienso y te aviso.' : 'Ok, dale, hago la transferencia.';
      }
      cursor += (3 + Math.random() * 25) * 60 * 1000; // 3–28 min between messages
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          sender,
          isFromAI,
          content: body,
          contentType: ContentType.TEXT,
          timestamp: new Date(cursor),
        },
      });
      lastBody = body;
      totalMessages++;
    }

    // Backfill conversation lastMessage* fields based on the thread tail
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessage: lastBody.slice(0, 140), lastMessageAt: new Date(cursor) },
    });
  }
  console.log(`  created ${N_CONVERSATIONS} conversations (~${totalMessages} messages, mean ${(totalMessages/N_CONVERSATIONS).toFixed(1)}/conv)`);
  return totalMessages;
}

// === Build leads across the pipeline ========================================
async function seedLeads(contacts: Array<{ id: string; type: CustomerType }>): Promise<void> {
  // Stage distribution chosen so each pipeline column has visible activity.
  const stages: Array<{ s: LeadStatus; n: number; updatedDaysBack?: [number, number] }> = [
    { s: LeadStatus.NEW, n: 14 },
    { s: LeadStatus.CONTACTED, n: 12 },
    // 6 of these stale (>25min ago) so the followup card shows urgency
    { s: LeadStatus.QUOTE_SENT, n: 10, updatedDaysBack: [0.02, 4] },
    { s: LeadStatus.NEGOTIATING, n: 6 },
    { s: LeadStatus.WON, n: 8 },
    { s: LeadStatus.LOST, n: 4 },
  ];
  let made = 0;
  for (const stage of stages) {
    for (let i = 0; i < stage.n; i++) {
      const c = pick(contacts);
      const products = PRODUCTS_BY_TYPE[c.type];
      const p = pick(products);
      const updatedAt = stage.updatedDaysBack
        ? new Date(Date.now() - (stage.updatedDaysBack[0] + Math.random() * (stage.updatedDaysBack[1] - stage.updatedDaysBack[0])) * 24 * 60 * 60 * 1000)
        : null;

      const lead = await prisma.lead.create({
        data: {
          contactId: c.id,
          status: stage.s,
          source: pickWeighted<Channel>(CHANNEL_WEIGHTS as any, 'ch'),
          productInterest: p.name,
          estimatedValue: p.price,
          wonAmount: stage.s === LeadStatus.WON ? p.price : null,
          lostReason: stage.s === LeadStatus.LOST ? pick(['precio', 'demora de envío', 'eligió competencia', 'sin respuesta']) : null,
        },
      });
      if (updatedAt) {
        // Prisma's @updatedAt overrides explicit values on insert, so force it
        // via raw SQL after the row exists. Required for stale-quote follow-up
        // card to actually show data.
        await prisma.$executeRawUnsafe(
          'UPDATE "leads" SET "updatedAt" = $1 WHERE "id" = $2',
          updatedAt, lead.id,
        );
      }
      made++;
    }
  }
  console.log(`  created ${made} leads across all pipeline stages`);
}

// === Build orders across status =============================================
async function seedOrders(contacts: Array<{ id: string; type: CustomerType }>): Promise<void> {
  const statuses: Array<{ s: OrderStatus; n: number }> = [
    { s: OrderStatus.CONFIRMED, n: 6 },
    { s: OrderStatus.PROCESSING, n: 5 },
    { s: OrderStatus.DISPATCHED, n: 5 },
    { s: OrderStatus.DELIVERED, n: 8 },
    { s: OrderStatus.CANCELLED, n: 2 },
  ];
  let n = 0;
  for (const stage of statuses) {
    for (let i = 0; i < stage.n; i++) {
      const c = pick(contacts);
      const products = PRODUCTS_BY_TYPE[c.type];
      const items = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => {
        const p = pick(products);
        const qty = 1 + Math.floor(Math.random() * 5);
        return { sku: p.name, quantity: qty, unitPrice: p.price, total: p.price * qty };
      });
      const amount = items.reduce((s, it) => s + it.total, 0);
      n++;
      const orderNumber = `DEMO-${String(Date.now()).slice(-6)}-${String(n).padStart(3, '0')}`;
      // Backdate every demo order past the 24h daily-digest lookback so the
      // digest's "new orders this window" assertions stay deterministic for
      // E2Es that seed their own fresh order to validate that path.
      const createdDaysBack = 2 + Math.random() * 5; // 2–7 days ago
      await prisma.order.create({
        data: {
          orderNumber,
          contactId: c.id,
          amount,
          currency: 'ARS',
          products: items as any,
          status: stage.s,
          trackingNumber: stage.s === OrderStatus.DISPATCHED || stage.s === OrderStatus.DELIVERED ? `OCA-${Math.floor(1e9 + Math.random()*9e9)}` : null,
          carrier: stage.s === OrderStatus.DISPATCHED || stage.s === OrderStatus.DELIVERED ? pick(['OCA', 'Andreani', 'transporte propio']) : null,
          dispatchedAt: stage.s === OrderStatus.DISPATCHED || stage.s === OrderStatus.DELIVERED ? new Date(Date.now() - 2 * 24 * 3600 * 1000) : null,
          deliveredAt: stage.s === OrderStatus.DELIVERED ? new Date(Date.now() - 1 * 24 * 3600 * 1000) : null,
          createdAt: new Date(Date.now() - createdDaysBack * 24 * 3600 * 1000),
        },
      });
    }
  }
  console.log(`  created ${n} orders across all statuses`);
}

// === Build a handful of formal quotes =======================================
async function seedQuotes(contacts: Array<{ id: string; type: CustomerType; name: string }>): Promise<void> {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const c = pick(contacts.filter((x) => x.type === CustomerType.MAYORISTA || x.type === CustomerType.INDUSTRIAL || x.type === CustomerType.PRFV_LAMINADOS));
    if (!c) continue;
    const products = PRODUCTS_BY_TYPE[c.type];
    const items = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => {
      const p = pick(products);
      const qty = 1 + Math.floor(Math.random() * 4);
      return { quantity: qty, description: p.name, unitPrice: p.price, total: p.price * qty };
    });
    const net = items.reduce((s, it) => s + it.total, 0);
    const tax = net * 0.21;
    n++;
    await prisma.quote.create({
      data: {
        quoteNumber: `0001-${String(Date.now()).slice(-8)}${String(n).padStart(2, '0')}`.slice(-13),
        contactId: c.id,
        buyerName: c.name,
        buyerLocality: pick(LOCALITIES),
        buyerTaxId: cuit(),
        buyerTaxStatus: 'IVA Responsable Inscripto',
        paymentMethod: pick(['Transferencia bancaria', 'Cuenta corriente 30 días', 'Cheque diferido']),
        paymentTerms: '50% anticipo / 50% contra entrega',
        deliveryTerm: '48 horas hábiles desde confirmación',
        currency: 'ARS',
        items: items as any,
        netAmount: net,
        taxRate: 0.21,
        taxAmount: tax,
        totalAmount: net + tax,
        status: pickWeighted<QuoteStatus>([
          { s: QuoteStatus.DRAFT, w: 0.1 } as any,
          { s: QuoteStatus.SENT, w: 0.55 } as any,
          { s: QuoteStatus.ACCEPTED, w: 0.20 } as any,
          { s: QuoteStatus.REJECTED, w: 0.10 } as any,
          { s: QuoteStatus.EXPIRED, w: 0.05 } as any,
        ] as any, 's'),
        expirationDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });
  }
  console.log(`  created ${n} formal quotes`);
}

async function main(): Promise<void> {
  console.log('=== Demo seeder (additive, idempotent) ===');
  console.log(`  contacts=${N_CONTACTS} conversations=${N_CONVERSATIONS} msg-mean=${MSG_MEAN} days-back=${N_DAYS_BACK}`);
  console.log('Cleaning previous demo rows...');
  await clearPreviousDemo();

  console.log('Seeding contacts...');
  const contacts = await seedContacts();

  console.log('Seeding conversations and messages...');
  const totalMsg = await seedConversationsAndMessages(contacts);

  console.log('Seeding leads...');
  await seedLeads(contacts);

  console.log('Seeding orders...');
  await seedOrders(contacts);

  console.log('Seeding quotes...');
  await seedQuotes(contacts);

  console.log('---');
  console.log(`Done. ${contacts.length} contacts, ${N_CONVERSATIONS} conversations, ${totalMsg} messages.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
