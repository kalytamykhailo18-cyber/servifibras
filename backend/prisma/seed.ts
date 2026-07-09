/**
 * Database Seed Script - Complete Test Data
 * Populates database with users, contacts, conversations, leads, orders, and knowledge base.
 *
 * Marcos 2026-07-09: this script DELETES every messages/conversations/orders/leads/contacts
 * row before writing its fixtures. If it runs against prod it wipes the business.
 * The pre-launch seed pass on 2026-04-28 left 8 fake contacts + 10 orders behind that
 * quietly polluted every dashboard until today. Guard added so it refuses to run unless
 * ALLOW_DESTRUCTIVE_SEED=1 is set explicitly. Never set that in prod.
 */

import { PrismaClient, UserRole, ContactType, Channel, ConversationStatus, LeadStatus, OrderStatus, ContentType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    console.error('❌ seed.ts ABORTED: this script deletes every conversation/message/order/lead/contact row.');
    console.error('   Set ALLOW_DESTRUCTIVE_SEED=1 to override. NEVER do that in prod.');
    process.exit(2);
  }
  console.log('🌱 Seeding Servifibras Database...');
  console.log('');

  // Clear existing data (in reverse order of dependencies)
  console.log('🗑️  Clearing existing data...');
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.contact.deleteMany({});
  await prisma.knowledgeBase.deleteMany({});
  await prisma.configuration.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('✓ Cleared existing data');
  console.log('');

  // ========================================
  // 1. USERS
  // ========================================
  console.log('👥 Creating users...');

  const hashedPassword = await bcrypt.hash('admin123', 10);
  const hashedDemoPassword = await bcrypt.hash('demo123', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@servifibras.com',
      username: 'admin',
      password: hashedPassword,
      name: 'Administrator',
      role: UserRole.ADMIN,
      active: true,
    },
  });

  const brenda = await prisma.user.create({
    data: {
      email: 'brenda@servifibras.com',
      username: 'brenda',
      password: hashedDemoPassword,
      name: 'Brenda García',
      role: UserRole.ATENCION,
      active: true,
    },
  });

  const franco = await prisma.user.create({
    data: {
      email: 'franco@servifibras.com',
      username: 'franco',
      password: hashedDemoPassword,
      name: 'Franco López',
      role: UserRole.VENTAS,
      active: true,
    },
  });

  const aldo = await prisma.user.create({
    data: {
      email: 'aldo@servifibras.com',
      username: 'aldo',
      password: hashedDemoPassword,
      name: 'Aldo Martínez',
      role: UserRole.LOGISTICA,
      active: true,
    },
  });

  console.log(`✓ Created 4 users (admin, brenda, franco, aldo)`);

  // ========================================
  // 2. CONTACTS
  // ========================================
  console.log('📇 Creating contacts...');

  const contacts = await Promise.all([
    prisma.contact.create({
      data: {
        name: 'Juan Pérez',
        phone: '+541112345678',
        type: ContactType.MINORISTA,
        channel: Channel.WHATSAPP,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'María González',
        phone: '+541123456789',
        email: 'maria@empresa.com',
        type: ContactType.MAYORISTA,
        channel: Channel.FACEBOOK,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'Carlos Rodríguez',
        phone: '+541134567890',
        type: ContactType.INDUSTRIAL,
        channel: Channel.INSTAGRAM,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'Laura Martínez',
        phone: '+541145678901',
        email: 'laura@taller.com',
        type: ContactType.EMPRENDEDOR,
        channel: Channel.TIENDANUBE_WEBCHAT,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'Roberto Silva',
        phone: '+541156789012',
        type: ContactType.MAYORISTA,
        channel: Channel.MERCADOLIBRE,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'Ana Torres',
        phone: '+541167890123',
        email: 'ana.torres@gmail.com',
        type: ContactType.MINORISTA,
        channel: Channel.WHATSAPP,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'Diego Fernández',
        phone: '+541178901234',
        type: ContactType.INDUSTRIAL,
        channel: Channel.FACEBOOK,
      },
    }),
    prisma.contact.create({
      data: {
        name: 'Sofía Ramírez',
        phone: '+541189012345',
        email: 'sofia@artesanias.com',
        type: ContactType.EMPRENDEDOR,
        channel: Channel.INSTAGRAM,
      },
    }),
  ]);

  console.log(`✓ Created ${contacts.length} contacts`);

  // ========================================
  // 3. CONVERSATIONS & MESSAGES
  // ========================================
  console.log('💬 Creating conversations and messages...');

  // Conversation 1: Juan Pérez - WhatsApp (ACTIVE)
  const conv1 = await prisma.conversation.create({
    data: {
      contactId: contacts[0].id,
      channel: Channel.WHATSAPP,
      status: ConversationStatus.ACTIVE,
      lastMessage: 'Perfecto Juan, tenemos stock. El precio es $15.000 por litro. ¿Te hacemos el pedido?',
      lastMessageAt: new Date(),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv1.id,
        sender: 'CUSTOMER',
        content: 'Hola, necesito resina poliéster. ¿Tienen stock?',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 min ago
      },
      {
        conversationId: conv1.id,
        sender: 'AI',
        content: 'Hola Juan! Sí, tenemos stock de resina poliéster. ¿Cuántos litros necesitas?',
        contentType: ContentType.TEXT,
        isFromAI: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 28),
      },
      {
        conversationId: conv1.id,
        sender: 'CUSTOMER',
        content: '20 litros',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 25),
      },
      {
        conversationId: conv1.id,
        sender: 'AI',
        content: 'Perfecto Juan, tenemos stock. El precio es $15.000 por litro. ¿Te hacemos el pedido?',
        contentType: ContentType.TEXT,
        isFromAI: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 20),
      },
    ],
  });

  // Conversation 2: María González - Facebook (ACTIVE)
  const conv2 = await prisma.conversation.create({
    data: {
      contactId: contacts[1].id,
      channel: Channel.FACEBOOK,
      status: ConversationStatus.ACTIVE,
      lastMessage: 'Excelente precio! ¿Tienen descuento por volumen?',
      lastMessageAt: new Date(Date.now() - 1000 * 60 * 15),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv2.id,
        sender: 'CUSTOMER',
        content: '¿Cuánto sale la fibra de vidrio Mat 300g?',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      },
      {
        conversationId: conv2.id,
        sender: 'AI',
        content: 'El Mat 300g está $8.500 por metro. Viene en rollos de 50m × 1m.',
        contentType: ContentType.TEXT,
        isFromAI: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 58),
      },
      {
        conversationId: conv2.id,
        sender: 'CUSTOMER',
        content: 'Excelente precio! ¿Tienen descuento por volumen?',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 15),
      },
    ],
  });

  // Conversation 3: Carlos Rodríguez - Instagram (WAITING - needs human)
  const conv3 = await prisma.conversation.create({
    data: {
      contactId: contacts[2].id,
      channel: Channel.INSTAGRAM,
      status: ConversationStatus.WAITING,
      assignedTo: brenda.id,
      lastMessage: 'Ok, déjame revisar y te confirmo',
      lastMessageAt: new Date(Date.now() - 1000 * 60 * 120),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv3.id,
        sender: 'CUSTOMER',
        content: 'Necesito cotización para un proyecto industrial grande',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 180),
      },
      {
        conversationId: conv3.id,
        sender: 'AI',
        content: 'Para proyectos industriales te contacto con nuestro equipo de ventas.',
        contentType: ContentType.TEXT,
        isFromAI: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 178),
      },
      {
        conversationId: conv3.id,
        sender: 'BRENDA',
        content: 'Hola Carlos, soy Brenda del equipo de atención. ¿Me podrías dar más detalles del proyecto?',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 150),
      },
      {
        conversationId: conv3.id,
        sender: 'CUSTOMER',
        content: 'Ok, déjame revisar y te confirmo',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 120),
      },
    ],
  });

  // Conversation 4: Laura Martínez - TiendaNube (ACTIVE)
  const conv4 = await prisma.conversation.create({
    data: {
      contactId: contacts[3].id,
      channel: Channel.TIENDANUBE_WEBCHAT,
      status: ConversationStatus.ACTIVE,
      lastMessage: 'Genial! ¿Cuánto saldría todo?',
      lastMessageAt: new Date(Date.now() - 1000 * 60 * 5),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv4.id,
        sender: 'CUSTOMER',
        content: 'Hola, quiero hacer moldes de silicona',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 10),
      },
      {
        conversationId: conv4.id,
        sender: 'AI',
        content: 'Perfecto! Tenemos silicona RTV para moldes. ¿Qué tipo de piezas vas a hacer?',
        contentType: ContentType.TEXT,
        isFromAI: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 8),
      },
      {
        conversationId: conv4.id,
        sender: 'CUSTOMER',
        content: 'Genial! ¿Cuánto saldría todo?',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
      },
    ],
  });

  // Conversation 5: Roberto Silva - MercadoLibre (WAITING)
  const conv5 = await prisma.conversation.create({
    data: {
      contactId: contacts[4].id,
      channel: Channel.MERCADOLIBRE,
      status: ConversationStatus.WAITING,
      lastMessage: 'Mensaje de prueba E2E desde el panel admin',
      lastMessageAt: new Date(Date.now() - 1000 * 60 * 2),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv5.id,
        sender: 'CUSTOMER',
        content: '¿Tienen envío a Córdoba?',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 10),
      },
      {
        conversationId: conv5.id,
        sender: 'ADMIN',
        content: 'Mensaje de prueba E2E desde el panel admin',
        contentType: ContentType.TEXT,
        isFromAI: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 2),
      },
    ],
  });

  console.log('✓ Created 5 conversations with 21 messages');

  // ========================================
  // 4. LEADS
  // ========================================
  console.log('🎯 Creating leads...');

  const leads = await Promise.all([
    // NEW leads
    prisma.lead.create({
      data: {
        contactId: contacts[1].id, // María González
        assignedTo: franco.id,
        status: LeadStatus.NEW,
        source: Channel.FACEBOOK,
        productInterest: 'Fibra de vidrio - proyecto piscina',
        estimatedValue: 50000,
        notes: 'Interesada en cotización para proyecto de piscina',
      },
    }),
    prisma.lead.create({
      data: {
        contactId: contacts[6].id, // Diego Fernández
        assignedTo: franco.id,
        status: LeadStatus.NEW,
        source: Channel.FACEBOOK,
        productInterest: 'Resina poliéster - tanques industriales',
        estimatedValue: 120000,
        notes: 'Empresa industrial, necesita volumen',
      },
    }),
    // CONTACTED leads
    prisma.lead.create({
      data: {
        contactId: contacts[2].id, // Carlos Rodríguez
        assignedTo: franco.id,
        status: LeadStatus.CONTACTED,
        source: Channel.INSTAGRAM,
        productInterest: 'Resina epoxi + fibra',
        estimatedValue: 85000,
        notes: 'Llamado realizado, enviando cotización formal',
      },
    }),
    prisma.lead.create({
      data: {
        contactId: contacts[5].id, // Ana Torres
        assignedTo: franco.id,
        status: LeadStatus.CONTACTED,
        source: Channel.WHATSAPP,
        productInterest: 'Silicona para moldes',
        estimatedValue: 25000,
        notes: 'Contacto establecido, esperando confirmación',
      },
    }),
    // QUOTE_SENT leads
    prisma.lead.create({
      data: {
        contactId: contacts[3].id, // Laura Martínez
        assignedTo: franco.id,
        status: LeadStatus.QUOTE_SENT,
        source: Channel.TIENDANUBE_WEBCHAT,
        productInterest: 'Kit completo emprendedores',
        estimatedValue: 35000,
        notes: 'Cotización enviada, válida por 7 días',
      },
    }),
    prisma.lead.create({
      data: {
        contactId: contacts[7].id, // Sofía Ramírez
        assignedTo: franco.id,
        status: LeadStatus.QUOTE_SENT,
        source: Channel.INSTAGRAM,
        productInterest: 'Resina cristal para artesanías',
        estimatedValue: 15000,
        notes: 'Quote sent via Instagram DM',
      },
    }),
    // NEGOTIATING lead
    prisma.lead.create({
      data: {
        contactId: contacts[4].id, // Roberto Silva
        assignedTo: franco.id,
        status: LeadStatus.NEGOTIATING,
        source: Channel.MERCADOLIBRE,
        productInterest: 'Compra mayorista resinas',
        estimatedValue: 250000,
        notes: 'Negociando descuento por volumen y forma de pago',
      },
    }),
    // WON leads
    prisma.lead.create({
      data: {
        contactId: contacts[0].id, // Juan Pérez
        assignedTo: franco.id,
        status: LeadStatus.WON,
        source: Channel.WHATSAPP,
        productInterest: 'Resina poliéster 20L',
        estimatedValue: 30000,
        wonAmount: 28500,
        notes: 'Cerrado! Cliente regular, se aplicó descuento',
      },
    }),
    prisma.lead.create({
      data: {
        contactId: contacts[1].id, // María González
        assignedTo: franco.id,
        status: LeadStatus.WON,
        source: Channel.FACEBOOK,
        productInterest: 'Mat + Resina combo',
        estimatedValue: 45000,
        wonAmount: 45000,
        notes: 'Orden confirmada, pago transferencia',
      },
    }),
    // LOST lead
    prisma.lead.create({
      data: {
        contactId: contacts[6].id, // Diego Fernández
        assignedTo: franco.id,
        status: LeadStatus.LOST,
        source: Channel.FACEBOOK,
        productInterest: 'Proyecto grande vinilester',
        estimatedValue: 180000,
        lostReason: 'Precio - eligió competidor más barato',
        notes: 'Perdimos por precio. Mantener contacto para futuro.',
      },
    }),
  ]);

  console.log(`✓ Created ${leads.length} leads (2 NEW, 2 CONTACTED, 2 QUOTE_SENT, 1 NEGOTIATING, 2 WON, 1 LOST)`);

  // ========================================
  // 5. ORDERS
  // ========================================
  console.log('📦 Creating orders...');

  const orders = await Promise.all([
    // CONFIRMED orders
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-001',
        contactId: contacts[0].id, // Juan Pérez
        amount: 28500,
        currency: 'ARS',
        products: [
          { name: 'Resina Poliéster', quantity: 20, price: 1425 },
        ],
        status: OrderStatus.CONFIRMED,
        notes: 'Cliente regular, pago en efectivo',
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-002',
        contactId: contacts[1].id, // María González
        amount: 45000,
        currency: 'ARS',
        products: [
          { name: 'Mat 300g', quantity: 50, price: 425 },
          { name: 'Resina Poliéster', quantity: 10, price: 2175 },
        ],
        status: OrderStatus.CONFIRMED,
        notes: 'Pago por transferencia confirmado',
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-003',
        contactId: contacts[5].id, // Ana Torres
        amount: 12000,
        currency: 'ARS',
        products: [
          { name: 'Silicona RTV 1kg', quantity: 3, price: 4000 },
        ],
        status: OrderStatus.CONFIRMED,
        notes: 'Retira por local',
      },
    }),
    // PROCESSING orders
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-004',
        contactId: contacts[3].id, // Laura Martínez
        amount: 35000,
        currency: 'ARS',
        products: [
          { name: 'Kit Emprendedor', quantity: 1, price: 35000 },
        ],
        status: OrderStatus.PROCESSING,
        notes: 'Preparando kit en almacén',
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-005',
        contactId: contacts[7].id, // Sofía Ramírez
        amount: 18000,
        currency: 'ARS',
        products: [
          { name: 'Resina Epoxi Cristal 5kg', quantity: 2, price: 9000 },
        ],
        status: OrderStatus.PROCESSING,
        notes: 'Endurecedor incluido',
      },
    }),
    // DISPATCHED orders
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-006',
        contactId: contacts[2].id, // Carlos Rodríguez
        amount: 95000,
        currency: 'ARS',
        products: [
          { name: 'Resina Epoxi 20kg', quantity: 3, price: 28000 },
          { name: 'Tela Roving 500g', quantity: 20, price: 550 },
        ],
        status: OrderStatus.DISPATCHED,
        trackingNumber: 'AND123456789',
        carrier: 'Andreani',
        dispatchedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
        notes: 'Envío a Córdoba',
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-007',
        contactId: contacts[4].id, // Roberto Silva
        amount: 250000,
        currency: 'ARS',
        products: [
          { name: 'Resina Poliéster 200L', quantity: 2, price: 125000 },
        ],
        status: OrderStatus.DISPATCHED,
        trackingNumber: 'AND987654321',
        carrier: 'Andreani',
        dispatchedAt: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
        notes: 'Mayorista - descuento aplicado',
      },
    }),
    // DELIVERED orders
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-008',
        contactId: contacts[6].id, // Diego Fernández
        amount: 65000,
        currency: 'ARS',
        products: [
          { name: 'Resina Poliéster 20L', quantity: 5, price: 13000 },
        ],
        status: OrderStatus.DELIVERED,
        trackingNumber: 'AND111222333',
        carrier: 'Andreani',
        dispatchedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // 5 days ago
        deliveredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
        notes: 'Entregado exitosamente',
      },
    }),
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-009',
        contactId: contacts[1].id, // María González
        amount: 120000,
        currency: 'ARS',
        products: [
          { name: 'Mat 450g', quantity: 100, price: 600 },
          { name: 'Resina Poliéster 200L', quantity: 1, price: 60000 },
        ],
        status: OrderStatus.DELIVERED,
        trackingNumber: 'AND444555666',
        carrier: 'Andreani',
        dispatchedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
        deliveredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
        notes: 'Cliente muy satisfecho, prometió recompra',
      },
    }),
    // CANCELLED order
    prisma.order.create({
      data: {
        orderNumber: 'ORD-2026-010',
        contactId: contacts[5].id, // Ana Torres
        amount: 8000,
        currency: 'ARS',
        products: [
          { name: 'Catalizador MEKP', quantity: 2, price: 4000 },
        ],
        status: OrderStatus.CANCELLED,
        notes: 'Cliente canceló - problema de stock',
      },
    }),
  ]);

  console.log(`✓ Created ${orders.length} orders (3 CONFIRMED, 2 PROCESSING, 2 DISPATCHED, 2 DELIVERED, 1 CANCELLED)`);

  // ========================================
  // 6. KNOWLEDGE BASE
  // ========================================
  console.log('📚 Creating knowledge base...');

  await prisma.knowledgeBase.createMany({
    data: [
      // RESINAS
      {
        category: 'Resinas',
        subcategory: 'Poliéster',
        title: 'Resina Poliéster - Características',
        content: `La resina poliéster es la más utilizada en la industria de composites por su excelente relación costo-beneficio.

Características principales:
- Buena resistencia mecánica
- Excelente adherencia a fibra de vidrio
- Resistencia a UV (apta para exteriores)
- Bajo encogimiento durante el curado
- Tiempo de curado: 24-48 horas a temperatura ambiente
- Relación de mezcla: 100:2 (resina:catalizador MEKP)

Aplicaciones típicas:
- Piletas y piscinas
- Botes y embarcaciones
- Tanques de almacenamiento
- Carrocerías
- Construcción en general

Presentaciones disponibles:
- 1 kg - $1.500
- 5 kg - $7.000
- 20 litros - $28.000
- 200 litros - $250.000 (mayorista)

Recomendación: Para mayor durabilidad en exteriores, aplicar gelcoat como capa final.`,
        active: true,
      },
      {
        category: 'Resinas',
        subcategory: 'Epoxi',
        title: 'Resina Epoxi - Características',
        content: `La resina epoxi ofrece las mejores propiedades mecánicas y químicas del mercado.

Características principales:
- Máxima resistencia mecánica
- Excelente resistencia química
- Muy baja absorción de agua
- Adherencia superior
- Sin encogimiento en el curado
- Tiempo de curado: 12-24 horas (depende del endurecedor)
- Relación de mezcla: varía según sistema (típico 100:30 o 100:50)

Aplicaciones típicas:
- Tablas de surf y kitesurf
- Embarcaciones de alta performance
- Reparaciones estructurales
- Pisos industriales
- Industria aeronáutica
- Arte y manualidades (resina cristal)

Presentaciones disponibles:
- 1 kg (incluye endurecedor) - $5.500
- 5 kg (incluye endurecedor) - $25.000
- 20 kg (incluye endurecedor) - $95.000

Diferencia con poliéster: La epoxi es más cara pero ofrece mejor resistencia mecánica, no encoge al curar, y tiene mejor resistencia al agua. Ideal para aplicaciones exigentes.`,
        active: true,
      },
      {
        category: 'Resinas',
        subcategory: 'Vinilester',
        title: 'Resina Vinilester - Características',
        content: `La resina vinilester combina las ventajas de poliéster y epoxi.

Características principales:
- Excelente resistencia química (superior a poliéster)
- Buena resistencia mecánica
- Mayor elongación que epoxi
- Resistencia a corrosión
- Tiempo de curado: similar a poliéster

Aplicaciones típicas:
- Tanques de químicos
- Ambientes corrosivos
- Industria química y petroquímica
- Scrubbers y torres de lavado

Presentaciones: bajo pedido para proyectos industriales.
Consultar precios por volumen.`,
        active: true,
      },
      // FIBRA DE VIDRIO
      {
        category: 'Fibra de Vidrio',
        subcategory: 'Mat',
        title: 'Mat de Fibra de Vidrio',
        content: `El mat es fibra de vidrio en forma de manta no tejida.

Tipos disponibles:
- Mat 300g/m² (rollo 50m × 1m) - $425/metro
- Mat 450g/m² (rollo 50m × 1m) - $600/metro
- Mat 600g/m² (bajo pedido)

Características:
- Fibras cortas orientadas al azar
- Fácil de aplicar
- Buena conformabilidad a formas complejas
- Proporciona resistencia multidireccional

Aplicaciones:
- Laminados generales
- Piscinas
- Tanques
- Capas intermedias en estructuras

Uso: Se aplica con resina poliéster o vinilester usando rodillo. Para epoxi, verificar compatibilidad (preferir mat sin aglutinante).`,
        active: true,
      },
      {
        category: 'Fibra de Vidrio',
        subcategory: 'Tela',
        title: 'Tela Roving de Fibra de Vidrio',
        content: `Tela tejida de fibra de vidrio continua.

Disponible:
- Roving 500g/m² - $550/metro
- Roving 800g/m² (bajo pedido)

Características:
- Fibras continuas tejidas
- Mayor resistencia que el mat
- Orientación bidireccional
- Acabado más liso

Aplicaciones:
- Embarcaciones de alto rendimiento
- Tablas de surf
- Estructuras que requieren máxima resistencia
- Capa exterior para mejor terminación

Uso: Compatible con resinas poliéster, epoxi y vinilester. Requiere técnica de laminado húmedo.`,
        active: true,
      },
      // CAUCHOS DE SILICONA
      {
        category: 'Cauchos de Silicona',
        subcategory: 'RTV',
        title: 'Silicona para Moldes RTV',
        content: `Cauchos de silicona para fabricación de moldes (temperatura ambiente).

Tipos disponibles:
- Shore A20 (blanda, flexible) - $4.200/kg
- Shore A30 (dureza media) - $4.500/kg
- Shore A40 (dura, detalles finos) - $4.800/kg

Características:
- Excelente reproducción de detalles
- Resistencia a rasgado
- Durabilidad (cientos de copias)
- No requiere desmoldante en la mayoría de casos
- Relación de mezcla típica: 100:10 (base:catalizador)
- Tiempo de curado: 24 horas

Aplicaciones:
- Moldes para resina epoxi
- Moldes para resina poliéster
- Reproducción de piezas
- Arte y artesanía
- Prototipos

Presentaciones:
- 1 kg - $4.500
- 5 kg - $21.000
- 25 kg - $95.000 (industrial)

Recomendación: Para piezas grandes usar silicona más blanda (Shore A20-A25). Para detalles finos usar Shore A35-A40.`,
        active: true,
      },
      // INFORMACIÓN GENERAL
      {
        category: 'Información General',
        subcategory: 'Compatibilidad',
        title: 'Compatibilidad de Productos',
        content: `Información importante sobre mezclas y compatibilidad:

⚠️ NUNCA mezclar:
- Resina epoxi con resina poliéster: NO son compatibles
- Diferentes tipos de resina en la misma pieza: causarán problemas de curado
- Catalizadores de diferentes resinas

Compatible:
- Mat de fibra de vidrio con poliéster: SÍ (ideal)
- Mat de fibra de vidrio con epoxi: Verificar (preferir mat sin aglutinante)
- Tela roving con todas las resinas: SÍ
- Gelcoat sobre poliéster: SÍ

Para abaratar costos:
- NO mezclar diferentes resinas
- SI usar resina poliéster en lugar de epoxi para aplicaciones menos exigentes
- SI usar mat en lugar de tela cuando no se requiera máxima resistencia`,
        active: true,
      },
      {
        category: 'Información General',
        subcategory: 'Seguridad',
        title: 'Seguridad y Manipulación',
        content: `Precauciones de seguridad al trabajar con estos productos:

Equipo de protección personal OBLIGATORIO:
- Guantes de nitrilo (obligatorio)
- Gafas de seguridad
- Mascarilla con filtro para vapores orgánicos
- Ropa que cubra la piel
- Ventilación adecuada

Resinas:
- Trabajar en área ventilada
- No inhalar vapores
- Evitar contacto con piel
- Catalizador MEKP es CORROSIVO
- Lavar manos después de usar

Fibra de vidrio:
- Usar guantes (causa picazón)
- Mascarilla contra polvo al cortar
- Lavar ropa separada después de usar
- No rascar si cae fibra en piel (lavar con agua fría)

Almacenamiento:
- Lugar fresco y seco (< 25°C)
- Lejos de fuentes de calor
- Catalizador separado de resinas
- Mantener tapado cuando no se use
- Fuera del alcance de niños`,
        active: true,
      },
      {
        category: 'Información General',
        subcategory: 'Entregas',
        title: 'Tiempos de Entrega y Stock',
        content: `Información sobre disponibilidad y envíos:

Stock habitual (disponibilidad inmediata):
- Resina poliéster: ✓ stock permanente
- Resina epoxi: ✓ stock permanente
- Mat 300g y 450g: ✓ stock permanente
- Tela roving 500g: ✓ stock permanente
- Silicona RTV: ✓ stock permanente
- Catalizador MEKP: ✓ stock permanente

Envíos:
- CABA y GBA: 24-48 horas
- Interior del país: 3-5 días hábiles vía Andreani
- Cálculo de costo: ingresar código postal en MercadoLibre
- Envío gratis en compras mayores a $50.000 (CABA/GBA)

Formas de pago:
- Efectivo (10% descuento)
- Transferencia bancaria
- MercadoPago (hasta 12 cuotas)
- Débito/Crédito

Compras mayoristas:
- Descuentos por volumen disponibles
- Atención personalizada con Franco (equipo de ventas)
- Consultar por productos específicos no listados
- Factura A o B según necesidad`,
        active: true,
      },
      // FAQ
      {
        category: 'FAQ',
        subcategory: 'Preguntas Frecuentes',
        title: '¿Cuál resina usar para mi proyecto?',
        content: `Guía rápida de selección de resina según aplicación:

USAR POLIÉSTER si:
- Proyecto al aire libre (piletas, botes, tanques)
- Necesitas buen precio
- No requieres máxima resistencia mecánica
- Trabajas con fibra de vidrio mat
- Aplicación general

USAR EPOXI si:
- Máxima resistencia mecánica requerida
- Contacto permanente con agua
- Reparaciones estructurales
- Tablas de surf/kitesurf
- No quieres encogimiento
- Presupuesto permite

USAR VINILESTER si:
- Contacto con químicos
- Ambiente corrosivo
- Tanques industriales
- Proyecto industrial específico

¿Dudas? Consultanos por WhatsApp y te asesoramos sin cargo.`,
        active: true,
      },
      {
        category: 'FAQ',
        subcategory: 'Preguntas Frecuentes',
        title: '¿Cuánto catalizador usar?',
        content: `Dosificación correcta de catalizador MEKP:

Para RESINA POLIÉSTER:
- Proporción: 2% del peso de resina
- Ejemplo: 1 litro resina = 20ml catalizador
- NUNCA exceder 3% (riesgo de explosión térmica)
- NUNCA usar menos de 1% (no curará)

Para RESINA EPOXI:
- Seguir instrucciones del fabricante
- Típico: 30-50% del peso de resina
- Mezclar exactamente según especificación
- No intercambiar endurecedores de diferentes sistemas

Temperatura ambiente:
- 20-25°C: dosificación normal
- < 15°C: aumentar ligeramente catalizador
- > 30°C: reducir catalizador (cura más rápido)

IMPORTANTE:
- Mezclar muy bien (mínimo 2 minutos)
- Nunca agregar catalizador directo del envase a resina grande
- Primero mezclar en recipiente pequeño
- Trabajar en lugar ventilado`,
        active: true,
      },
      // TUTORIALES
      {
        category: 'Tutoriales',
        subcategory: 'Paso a Paso',
        title: 'Cómo hacer un laminado básico',
        content: `Tutorial paso a paso para laminado con poliéster y mat:

MATERIALES NECESARIOS:
- Resina poliéster
- Catalizador MEKP
- Mat de fibra de vidrio
- Molde preparado
- Rodillo para laminado
- Guantes de nitrilo
- Gafas de seguridad
- Recipiente para mezclar

PASO A PASO:

1. PREPARACIÓN (15 min):
   - Preparar área ventilada
   - Colocar guantes y gafas
   - Aplicar desmoldante en molde
   - Dejar secar desmoldante 10 min

2. MEZCLA DE RESINA (5 min):
   - Verter resina en recipiente
   - Agregar 2% de catalizador
   - Mezclar 2-3 minutos completamente
   - Tiempo de trabajo: 15-20 minutos

3. GELCOAT (Opcional, 10 min):
   - Aplicar capa fina de gelcoat
   - Dejar gelificar (tacto seco)
   - Continuar con laminado

4. PRIMER CAPA (20 min):
   - Aplicar resina al molde con brocha
   - Colocar primera capa de mat
   - Impregnar con resina
   - Pasar rodillo para sacar burbujas

5. CAPAS ADICIONALES:
   - Repetir: resina → mat → rodillo
   - Sacar burbujas de cada capa
   - Mínimo 3 capas para resistencia

6. CURADO (24-48 horas):
   - Dejar curar a temperatura ambiente
   - No mover durante curado
   - Desmoldar cuando esté duro

7. ACABADO:
   - Lijar imperfecciones
   - Pulir si es necesario

TIPS:
- Trabajar rápido (la resina gelifica)
- Siempre sacar burbujas
- Más capas = más resistencia`,
        active: true,
      },
      {
        category: 'Tutoriales',
        subcategory: 'Paso a Paso',
        title: 'Cómo hacer moldes de silicona',
        content: `Tutorial para crear moldes de silicona RTV:

MATERIALES:
- Silicona RTV (base + catalizador)
- Pieza original a copiar
- Caja contenedora
- Plastilina
- Desmoldante
- Balanza

PASO A PASO:

1. PREPARAR PIEZA (10 min):
   - Limpiar pieza original
   - Aplicar desmoldante
   - Dejar secar

2. CREAR CAJA (15 min):
   - Hacer caja con madera/cartón
   - Debe dejar 2cm de espacio alrededor
   - Sellar con plastilina las juntas

3. CALCULAR VOLUMEN (5 min):
   - Llenar caja con agua
   - Medir cuánta agua cabe
   - Esa es la silicona necesaria

4. MEZCLAR SILICONA (10 min):
   - Proporción: 100:10 (base:catalizador)
   - Ejemplo: 500g base = 50g catalizador
   - Mezclar muy bien
   - Sacar burbujas con espátula

5. VERTER SILICONA (5 min):
   - Verter desde altura para sacar burbujas
   - Llenar hasta cubrir pieza completamente
   - Golpear suavemente la caja

6. CURADO (24 horas):
   - Dejar en lugar fresco
   - No mover durante curado
   - Temperatura ideal: 20-25°C

7. DESMOLDAR (10 min):
   - Quitar caja contenedora
   - Extraer pieza original con cuidado
   - Molde listo para usar

TIPS:
- Shore A20-A30 para piezas grandes
- Shore A35-A40 para detalles finos
- No apurar el curado
- El molde dura cientos de copias`,
        active: true,
      },
    ],
  });

  const knowledgeCount = await prisma.knowledgeBase.count();
  console.log(`✓ Created ${knowledgeCount} knowledge base items`);

  // ========================================
  // SUMMARY
  // ========================================
  console.log('');
  console.log('✅ Database seeded successfully!');
  console.log('');
  console.log('📊 Summary:');
  console.log(`   - ${await prisma.user.count()} users (admin, brenda, franco, aldo)`);
  console.log(`   - ${await prisma.contact.count()} contacts`);
  console.log(`   - ${await prisma.conversation.count()} conversations`);
  console.log(`   - ${await prisma.message.count()} messages`);
  console.log(`   - ${await prisma.lead.count()} leads (across all statuses)`);
  console.log(`   - ${await prisma.order.count()} orders (across all statuses)`);
  console.log(`   - ${await prisma.knowledgeBase.count()} knowledge base items`);
  console.log('');
  console.log('👥 Test Users:');
  console.log('   - admin@servifibras.com / admin123 (ADMIN)');
  console.log('   - brenda@servifibras.com / demo123 (ATENCION)');
  console.log('   - franco@servifibras.com / demo123 (VENTAS)');
  console.log('   - aldo@servifibras.com / demo123 (LOGISTICA)');
  console.log('');
  console.log('🚀 Ready to test at: https://dev.ustymkushnir.com');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
