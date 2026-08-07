// Marcos 2026-08-07 (WhatsApp 09:59 AR): "El agente no funciona.
// No sigue el hilo de la conversación, no retiene lo que el cliente
// dijo dos mensajes antes, contesta cosas que no tienen relación."
// Root cause en buildAIContext (conversation-handler.service.ts):
// tagueaba TODO mensaje no-AI como role=user. Como el 97.8% de las
// conversaciones de WhatsApp tienen aiPaused=true y son manejadas
// manualmente por el equipo (sender=ADMIN, isFromAI=false), Claude
// veía las respuestas del propio equipo como si fueran del cliente
// — un hilo tipo:
//   Cliente: "¿tienen resina?"
//   Marcos-manual: "sí, $55000"
//   Cliente: "¿es apta para artesanías?"
// llegaba a Claude como 3 mensajes "user" seguidos. Sin ninguna
// separación de lado, Claude no puede sostener contexto porque
// "cree" que el cliente contradice sus propias afirmaciones. De ahí
// la incoherencia percibida.
//
// Fix: taguear por LADO de conversación (cliente vs equipo/AI), no
// por origen técnico. Sender ADMIN/BRENDA/FRANCO/ALDO ahora cuenta
// como 'assistant' — Claude lo lee como respuesta del lado del
// negocio (equipo o AI, misma "voz"). Además mergeamos consecutivos
// del mismo rol para preservar alternancia.
//
// Este test valida:
//   1. AI reply → 'assistant'
//   2. CUSTOMER msg → 'user'
//   3. Staff manual reply (ADMIN sin isFromAI) → 'assistant' (fix!)
//   4. Consecutivos del mismo rol se mergean
//   5. Mensajes vacíos (media sin caption) se skipean

const path = require('path');

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const handler = app.get(ConversationHandlerService);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // The method is private; we call via bracket access since JS.
  const build = handler.buildAIContext.bind(handler);

  // Cipher decrypts plaintext-as-is when no key is configured (dev/test),
  // so raw strings in `content` are fine here.
  const mkMsg = (sender, content, isFromAI = false) => ({ sender, content, isFromAI });

  // (1) All-AI conversation — alternation preserved
  {
    const conv = build([
      mkMsg('CUSTOMER', 'Hola, ¿tienen resina epoxi?'),
      mkMsg('AI', 'Sí, tenemos varias opciones.', true),
      mkMsg('CUSTOMER', '¿Cuál sirve para artesanías?'),
    ]);
    ok('AI-only history preserves alternation user/assistant/user',
       conv.messages.length === 3 &&
       conv.messages[0].role === 'user' &&
       conv.messages[1].role === 'assistant' &&
       conv.messages[2].role === 'user',
       `roles=${conv.messages.map(m => m.role).join(',')}`);
  }

  // (2) THE BUG SCENARIO: staff manual reply in the middle
  {
    const conv = build([
      mkMsg('CUSTOMER', '¿tienen resina epoxi?'),
      mkMsg('ADMIN', 'Sí, $55000 el litro'),         // Marcos from CRM manual
      mkMsg('CUSTOMER', '¿es apta para artesanías?'),
    ]);
    ok('staff ADMIN manual reply → tagged as assistant (was user before fix)',
       conv.messages.length === 3 &&
       conv.messages[0].role === 'user' &&
       conv.messages[1].role === 'assistant' &&
       conv.messages[2].role === 'user',
       `roles=${conv.messages.map(m => m.role).join(',')}`);
  }

  // (3) Multiple staff senders (Brenda + Franco + Aldo) all count as assistant
  {
    const conv = build([
      mkMsg('CUSTOMER', 'Consulta 1'),
      mkMsg('BRENDA', 'Respuesta de Brenda'),
      mkMsg('CUSTOMER', 'Consulta 2'),
      mkMsg('FRANCO', 'Respuesta de Franco'),
      mkMsg('CUSTOMER', 'Consulta 3'),
      mkMsg('ALDO', 'Respuesta de Aldo'),
    ]);
    const roles = conv.messages.map(m => m.role).join(',');
    ok('BRENDA/FRANCO/ALDO all → assistant', roles === 'user,assistant,user,assistant,user,assistant', `roles=${roles}`);
  }

  // (4) Consecutive same-role messages get merged
  {
    const conv = build([
      mkMsg('CUSTOMER', 'primer mensaje'),
      mkMsg('CUSTOMER', 'segundo mensaje seguido'),   // cliente escribió dos veces
      mkMsg('ADMIN', 'respuesta parte 1'),
      mkMsg('ADMIN', 'respuesta parte 2'),            // staff escribió dos veces
      mkMsg('CUSTOMER', 'tercer cliente'),
    ]);
    ok('consecutive user msgs merged into one', conv.messages.length === 3, `count=${conv.messages.length}`);
    ok('merged user content preserves both messages',
       conv.messages[0].content.includes('primer mensaje') &&
       conv.messages[0].content.includes('segundo mensaje seguido'));
    ok('merged assistant content preserves both parts',
       conv.messages[1].content.includes('parte 1') &&
       conv.messages[1].content.includes('parte 2'));
  }

  // (5) Empty content (media without caption) is skipped
  {
    const conv = build([
      mkMsg('CUSTOMER', 'texto real'),
      mkMsg('CUSTOMER', ''),          // media sin caption
      mkMsg('CUSTOMER', '  \n  '),    // whitespace only
      mkMsg('ADMIN', 'respuesta'),
    ]);
    ok('empty/whitespace msgs skipped', conv.messages.length === 2,
       `count=${conv.messages.length}, roles=${conv.messages.map(m => m.role).join(',')}`);
  }

  // (6) Phone-side outbound (ADMIN with source=phone) also counts as assistant
  // (the shape is the same for the buildAIContext — sender=ADMIN is sender=ADMIN)
  {
    const conv = build([
      mkMsg('CUSTOMER', 'consulta'),
      { sender: 'ADMIN', content: 'respuesta desde celular', isFromAI: false, metadata: { source: 'phone' } },
    ]);
    ok('phone-side ADMIN reply → assistant', conv.messages[1].role === 'assistant');
  }

  // (7) AI + staff mix — AI reply, then staff overrides
  {
    const conv = build([
      mkMsg('CUSTOMER', 'consulta'),
      mkMsg('AI', 'AI genérico', true),
      mkMsg('ADMIN', 'corrección manual del operador'),
      mkMsg('CUSTOMER', 'otra pregunta'),
    ]);
    // AI (assistant) + ADMIN (assistant) get merged
    const roles = conv.messages.map(m => m.role).join(',');
    ok('AI followed by staff correction: both merged as assistant',
       roles === 'user,assistant,user',
       `roles=${roles}`);
    ok('merged assistant preserves both AI and staff text',
       conv.messages[1].content.includes('AI genérico') &&
       conv.messages[1].content.includes('corrección manual'));
  }

  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
