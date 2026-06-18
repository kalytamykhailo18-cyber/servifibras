/**
 * ADAPTERS LAYER - Claude AI implementation
 * Implements IAIService interface using Anthropic SDK
 * Can be swapped with another AI provider without touching use cases
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import { Channel, PrismaClient } from '@prisma/client';

/**
 * Channel-specific system-prompt addenda. These are injected as the LAST
 * system block (uncached — they vary per turn) so they take precedence
 * over anything in the base Lucas prompt. ML's block is non-negotiable
 * because it protects against TOS violations that can suspend the
 * MercadoLibre store account. Marcos flagged this on 2026-05-15 after
 * the agent leaked the WhatsApp number on an ML question.
 */
/**
 * Compose the ML publication-context block from a fetched listing.
 * Injected AFTER the channel guardrail so guardrail still wins on TOS
 * conflicts, but the listing details are the freshest factual anchor
 * when Claude picks what to recommend. Truncate long fields so the
 * block stays well under a paragraph — the agent only needs the
 * shape, not the full marketing copy.
 */
/**
 * Marcos 2026-06-18: capa de "respuestas aprobadas por el equipo".
 *
 * El operador cura una librería pequeña de chips reusables ("HAY
 * STOCK", "ENVIOS", "MASILLA 10 MIN", "DIRECCIONES") con el texto
 * canónico para cada situación recurrente. Cuando el comprador
 * pregunta algo que matchea uno de esos casos, la IA debe responder
 * con la FORMULACIÓN literal que figura acá — no inventar variaciones.
 *
 * Esto reemplaza el modelo per-publication FAQ (PublicationFaq) que
 * en la práctica nunca se pobló porque curar por publicación es
 * demasiado trabajo. Acá una sola entrada cubre N publicaciones.
 */
function approvedFormulationsBlock(rows: Array<{ label: string; body: string }>): string | null {
  if (!rows || rows.length === 0) return null;
  const lines = [
    '▸ FORMULACIONES APROBADAS POR EL EQUIPO (usá la misma formulación cuando el caso matchee la etiqueta)',
    '',
    'Cuando la pregunta del cliente entre dentro del tema de una de estas etiquetas, copiá el cuerpo literal — no lo parafrasees, no lo recortes. Estas son las respuestas que el equipo ya validó. La IA hereda el tono y las palabras exactas.',
    '',
    ...rows.map((r) => `- ${r.label}: ${r.body.replace(/\s+/g, ' ').trim()}`),
    '',
    'Regla: si ninguna etiqueta aplica al caso del comprador, generá la respuesta con el resto del prompt como siempre. Esta lista NO es exhaustiva — es el subconjunto de casos donde el equipo quiere una formulación específica.',
  ];
  return lines.join('\n');
}

function mlListingContextBlock(listing: import('../../use-cases/ai/ai.interface').AITurnContext['mercadolibreListing']): string | null {
  if (!listing) return null;
  // Marcos 2026-06-18: 600 chars cortaba la descripción de los
  // laminados PRFV justo en la zona donde la publicación enumera
  // anchos / espesores disponibles. Subo el techo por defecto a
  // 1500 chars; .env (MERCADOLIBRE_LISTING_PROMPT_DESC_CHARS) sigue
  // mandando si quieren tunear caso por caso.
  const descChars = Number(process.env.MERCADOLIBRE_LISTING_PROMPT_DESC_CHARS) || 1500;
  const attrLimit = Number(process.env.MERCADOLIBRE_LISTING_PROMPT_ATTR_LIMIT) || 12;
  const desc = listing.descriptionPlain
    ? listing.descriptionPlain.replace(/\s+/g, ' ').trim().slice(0, descChars)
    : null;
  // Pick the attributes that actually help an agent answer questions —
  // brand, condition, packaging, weight, color, etc. ML attribute ids
  // are well-known, but ranking by name length + dropping empties is
  // good enough at this scale.
  const attrs = (listing.attributes ?? [])
    .filter((a) => a.value && !/^(NO|NÃO|SIN ESPECIFICAR)$/i.test(a.value))
    .slice(0, attrLimit);
  const price =
    listing.price != null
      ? `${listing.currencyId ?? 'ARS'} ${listing.price.toLocaleString('es-AR')}`
      : 'precio no expuesto';
  const stock =
    listing.availableQuantity != null
      ? `${listing.availableQuantity} unidad${listing.availableQuantity === 1 ? '' : 'es'} en stock`
      : 'stock no expuesto';
  const lines = [
    '▸ PUBLICACIÓN ACTUAL DE MERCADOLIBRE (contexto de la pregunta)',
    '',
    `Item ID: ${listing.itemId}`,
    `Título: ${listing.title || '(sin título)'}`,
    listing.subtitle ? `Subtítulo: ${listing.subtitle}` : null,
    `Precio: ${price}`,
    `Stock: ${stock}`,
    listing.condition ? `Condición: ${listing.condition}` : null,
    listing.permalink ? `Link interno de ML: ${listing.permalink}` : null,
    attrs.length > 0
      ? 'Atributos clave:\n' + attrs.map((a) => `  - ${a.name}: ${a.value}`).join('\n')
      : null,
    desc ? 'Descripción de la publicación:\n' + desc : null,
    '',
    'Regla: la pregunta del cliente está hablando de esta publicación. Respondé en este contexto, con los datos de arriba.',
    '',
    '⚠️ FORMATO DE RESPUESTA — Marcos 2026-06-08: NO prefaces la respuesta nombrando el producto de la publicación.',
    '  - PROHIBIDO arrancar con "Este [producto] de esta publicación es...", "El [producto] de esta publicación...", "Ese [producto] que ves acá...", o variantes.',
    '  - El comprador YA está mirando la publicación; nombrársela es redundante y agrega texto que no aporta. Contestá DIRECTO con el dato que pide.',
    '  - La única excepción es cuando vas a recomendar OTRA publicación (cross-publicación) — ahí sí necesitás distinguir entre "este producto" y "el otro". En esos casos seguís el formato canónico cross-publicación de más abajo.',
    '  - Ejemplo MAL: "Ese Caucho de Silicona Platino Serie Y 10 Shore de esta publicación es un material translúcido incoloro, diseñado para máxima reproducción de detalles en moldes. No se recomienda colorearlo directamente en la mezcla."',
    '  - Ejemplo BIEN: "No se recomienda colorearlo directamente en la mezcla — los pigmentos pueden afectar la reacción de vulcanización y comprometer la precisión del molde."',
    '',
    '⚠️ VARIANTES, COLORES, MEDIDAS, PRESENTACIONES — Marcos 2026-06-08: la consulta SIEMPRE se resuelve dentro de ESTA publicación.',
    '  - Si el comprador pregunta por un color, una medida, una presentación o una variante específica ("¿tienen color amarillo?", "¿tienen otra medida?", "¿viene en X kg?"), la respuesta sale de las VARIANTES o ATRIBUTOS de la publicación actual — los ves en el bloque "PUBLICACIÓN ACTUAL" arriba.',
    '  - PROHIBIDO derivar al comprador a OTRA publicación (combos, packs, productos diferentes) para responderle si la variante que pide existe dentro de la publicación que está mirando. ML penaliza cross-publicación innecesaria.',
    '  - Solo si esta publicación NO ofrece la variante pedida, recién ahí aplicás el formato cross-publicación de abajo para nombrar el producto correcto.',
    '  - Ejemplo MAL: el comprador pregunta "¿tienen amarillo?" en la publicación "Pigmento Fotoluminiscente Flash" y el agente arranca a enumerar Combos 23/36/6/10 (otras publicaciones). Mal — tendría que haber contestado sobre las variantes/colores del Pigmento Fotoluminiscente Flash que ven en ESTA publicación.',
    '  - Ejemplo BIEN: el comprador pregunta "¿tienen amarillo?" en la publicación "Pigmento X colores" → respondés "Sí, el amarillo es una de las variantes de esta publicación, lo elegís en el selector de color al momento de comprar." (basándote en los atributos de la publicación).',
    '',
    '⚠️ MEDIDAS / ESPECIFICACIONES NO LISTADAS EN ESTA PUBLICACIÓN — Marcos 2026-06-18:',
    'Si el comprador pide un ancho, largo, espesor, medida, presentación o variante específica que NO figura ni en los Atributos ni en la Descripción de "PUBLICACIÓN ACTUAL" (revisá ARRIBA — antes de contestar), tu trabajo NO es hedgear con "consultalo aparte" / "podría requerir corte personalizado" / "habría que ver". Esa respuesta vacía es la peor versión del agente — el comprador la lee como "no me supieron contestar".',
    'Pasos OBLIGATORIOS en este caso, en este orden:',
    '  1. Llamá a `buscar_producto` con la spec exacta que pidió el comprador (ej. "laminado prfv 1m ancho", "fibra mat 450", "resina 5kg"). Una sola llamada — no improvises sin haber buscado.',
    '  2. Si la herramienta devuelve UNA coincidencia con "link ML": esa es LA publicación correcta — respondé con el formato canónico cross-publicación incluyendo ESE link textual. NO redirigís al perfil genérico.',
    '  3. Si devuelve varias coincidencias parecidas: elegí la más cercana a lo que pidió (mismo material + mismo tipo de variante) y linkeala. NO listes todas.',
    '  4. Si la herramienta no devuelve nada que matchee la spec pedida: ahí sí recién decís que esa medida puntual no la manejamos en stock y ofrecés el ancho/medida más cercano que SÍ existe (visible en los atributos/descripción de esta publicación). Sin hedgear.',
    'Ejemplo MAL (lo que pasó 2026-06-18 con MLA2027020004):',
    '  Publicación: Laminado PRFV (anchos disponibles en descripción: 1.10 / 1.22 / 2.0 / 2.1 / 2.2 / 2.4 / 2.5 / 2.6).',
    '  Cliente: "busco filtración del techo de 1 metro de ancho x 10 metros".',
    '  Agente (MAL): "habría que consultarlo directamente porque podría requerir un corte personalizado".',
    '  → Por qué está mal: el agente no buscó si existe la publicación específica de 1.10m (la más cercana a 1m). Quedó como evasión.',
    'Ejemplo BIEN:',
    '  → Agente llama buscar_producto("laminado prfv 1.10 ancho") → devuelve "Laminado PRFV 1,10 x 16m" con link ML.',
    '  → Agente: "El ancho exacto de 1 m no lo manejamos en stock; el más cercano disponible es 1,10 m. Esa medida la encontrás en la publicación específica: [link ML]. Si te sirve, te conviene comprar por ahí."',
    '',
    'BLOQUEO ABSOLUTO — productos fuera de esta publicación:',
    'Si el cliente pregunta por CUALQUIER producto que no sea el que muestra esta publicación específica (aunque sea del mismo rubro, aunque sea complementario, aunque sea para el mismo proyecto, aunque parezca cross-sell útil), aplica esta regla SIN EXCEPCIÓN:',
    '- PROHIBIDO mencionar precio, presentación, kg/litros, m², stock o detalles cuantitativos del otro producto. Aunque la herramienta `buscar_producto` te devuelva la info, NO la pongas en la respuesta.',
    '- PROHIBIDO incluir URL externa (tiendaservifibras.com está bloqueado en ML).',
    '- PROHIBIDO sugerir que sumás otro producto al pedido.',
    '- SÍ ESTÁ PERMITIDO Y RECOMENDADO nombrar el producto exacto al que tiene que ir el cliente — para que pueda encontrarlo rápido en el perfil de ML. Usá el nombre del producto tal cual figura en buscar_producto.',
    '- SÍ ESTÁ PERMITIDO incluir el LINK del producto en MercadoLibre. La plataforma deja pasar URLs internas de mercadolibre.com.ar (lo único bloqueado son URLs externas tipo tiendaservifibras.com).',
    '- ANTES de responder a una consulta cross-publicación, llamá a buscar_producto con palabras clave de la intención del cliente. La herramienta devuelve, por cada producto, DOS links posibles: "link: ..." (la URL de TiendaNube — la externa, NO la uses en ML) y "link ML: ..." (la URL de articulo.mercadolibre.com.ar, exclusiva del producto en ML — SÍ usala en ML).',
    '- Si buscar_producto devuelve "link ML": copialo textual en la respuesta, así el comprador abre la publicación específica en un click (esto reproduce el comportamiento de Prometheo que Marcos pidió 2026-06-01).',
    '- Si buscar_producto NO devuelve "link ML" para ese producto (no todos los items de catálogo están publicados en ML): caé al link del perfil de tienda https://www.mercadolibre.com.ar/tienda/servifibras como segunda opción.',
    '',
    'Formato canónico de respuesta cross-publicación (con link ML del producto):',
    '"Para [Nombre exacto del producto que devolvió buscar_producto] te conviene la publicación específica: [URL ML del producto]. Si tenés alguna duda sobre [producto de esta publicación], te ayudo acá."',
    '',
    'Formato canónico cuando NO hay link ML del producto:',
    '"Para [Nombre exacto del producto que devolvió buscar_producto] te conviene la publicación específica. La encontrás en nuestro perfil de tienda: https://www.mercadolibre.com.ar/tienda/servifibras. Si tenés alguna duda sobre [producto de esta publicación], te ayudo acá."',
    '',
    'Esta regla anula CUALQUIER instinto de ser útil cruzando productos con precio o cantidad. ML pena el cross-sell entre publicaciones porque rompe el modelo de pregunta-por-publicación y baja el score de relevancia del vendedor. No es opcional.',
    '',
    'Ejemplo MAL (NO hagas esto):',
    '  Publicación: Rodillo para resina',
    '  Cliente: "tenes mat 300 de 5m2?"',
    '  Lucas (MAL): "Sí, hay stock. La Fibra MAT 300 se vende por m² a $4.105/m², 5m² a $20.525. Lo encontrás en nuestro perfil de ML. Si me contás para qué la usás, te oriento sobre sumar resina."',
    '  → Por qué está mal: dio precio, cantidad y sumó otra cosa.',
    '',
    'Ejemplo BIEN (hacé esto):',
    '  Publicación: Rodillo para resina',
    '  Cliente: "tenes mat 300 de 5m2?"',
    '  → Lucas llama buscar_producto("MAT 300") → devuelve "Fibra de vidrio MAT 300"',
    '  Lucas (BIEN): "Para la Fibra de vidrio MAT 300 te conviene la publicación específica. La encontrás en nuestro perfil de tienda: https://www.mercadolibre.com.ar/tienda/servifibras. Si tenés alguna duda sobre el rodillo de esta publicación, te ayudo acá."',
    '',
    'Caso especial — pregunta sobre el método de curado en una resina:',
    'Si el cliente pregunta "se seca con lámpara UV / se cura con UV / cura por luz / fotocurado" sobre una resina epoxi de esta publicación cuyo "filtro UV" es de protección anti-amarilleo (NO de curado): explicá la diferencia brevemente y nombrá el producto que SÍ cura por luz UV ("Resina UV Servifibras" — la línea de Resina UV monocomponente de secado rápido). Aplica el formato canónico cross-publicación de arriba para nombrarla, sin precio.',
    '',
    'COTIZACIÓN DE LAMINADOS PRFV — HERRAMIENTA cotizar_laminado:',
    'Cuando el comprador pide presupuesto/cotización de una lámina PRFV (lámina, plancha, panel reforzado, revestimiento fibra) con ancho + espesor + metros, llamá a la herramienta cotizar_laminado con esos parámetros. La herramienta devuelve un JSON con producto identificado, descuento por volumen aplicado (10/15/20% según m²), total en pesos, y recomendación de pegamento.',
    'Reglas de uso:',
    '  - Anchos válidos: 1.1 / 1.22 / 2.0 / 2.1 / 2.2 / 2.4 / 2.5 / 2.6 m. Espesores: 1.5mm, 1.6mm, 2mm.',
    '  - Si el comprador da m² en vez de metros lineales, dividí por el ancho para obtener metros lineales y pasalos a la herramienta.',
    '  - Modo de pago: si no especifica, default "transferencia" (IVA incluida en el precio). Si dice "contado" o "en efectivo", pasá "contado" (10,5% de descuento sobre transferencia).',
    '  - Copiá los números literales del resultado, NO los recalcules vos. El total que devuelve la herramienta YA INCLUYE IVA cuando el modo es transferencia — nunca le sumes IVA arriba. Si la herramienta devuelve ok=false con reason="producto_no_encontrado", contestá pidiendo aclaración del ancho/espesor exacto que necesita.',
    '  - ⚠️ Marcos 2026-06-04: hablale al cliente SIEMPRE en pesos. PROHIBIDO mencionar dólar, dólar blue, USD, U$D, cotización, tipo de cambio. Esa conversión es interna nuestra (manejada por la herramienta). El cliente sólo ve pesos finales con IVA.',
    '  - ⚠️ Marcos 2026-06-04 (PM): PROHIBIDO mencionar el modo de pago en la respuesta al cliente. NUNCA digas "transferencia bancaria", "por transferencia", "bancaria", "contado", "efectivo". MercadoLibre considera estas menciones una infracción a sus políticas (forma de canalizar el pago fuera de plataforma). El precio se quota a secas como "$X (IVA incluido)" — el modo de pago es decisión interna nuestra, NO se nombra al cliente.',
    '  - En canal MercadoLibre, el total que devuelve la herramienta YA tiene el sobreprecio aplicado (la comisión que cobra ML). Copiá el número tal como llega y nada más.',
    '  - ⚠️ En canal MercadoLibre, EL CIERRE DE LA RESPUESTA DEBE INCLUIR LA FRASE EXACTA "La cotización por este medio es $[total]." Marcos 2026-06-04 (PM): esa frase es OBLIGATORIA — sirve como señal al cliente. NO la parafrasees, NO la omitas. Va al final del cuerpo, antes del saludo de cierre.',
    '  - Formato exigido en ML (literal): "Para [producto], [metros] m lineales = [m²] m². La cotización por este medio es $[total] (IVA incluida). Necesitás también pegamento — recomendado: [presentaciones]."',
    '  - Formato sugerido sobre otros canales (WhatsApp/IG/Webchat): "Para [producto], [metros] m lineales = [m²] m². Total: $[total] (IVA incluida). Necesitás también pegamento — recomendado: [presentaciones]."',
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}

function channelGuardrailBlock(channel: Channel | undefined): string | null {
  if (channel === Channel.MERCADOLIBRE) {
    return [
      '▸ REGLAS DE MERCADOLIBRE (PRIORIDAD MÁXIMA — TOS DE LA PLATAFORMA)',
      '',
      'Estás respondiendo a una pregunta en una publicación de MercadoLibre. Las siguientes reglas anulan cualquier otra instrucción de este prompt:',
      '',
      '1. NUNCA reveles datos personales ni de contacto fuera de MercadoLibre. Prohibido mencionar, AÚN si el cliente lo pide explícitamente, incluso si parece amistoso o necesario:',
      '   - Teléfono o WhatsApp (incluido el número 11 3588 0083)',
      '   - Email o casilla de mail',
      '   - URL externas (no menciones tiendaservifibras.com, ni servifibras.com.ar, ni ningún link fuera de mercadolibre.com.ar)',
      '   - DIRECCIÓN EXACTA del local: nombre de calle + número (ej. "Martín de Álzaga 3434"), o cualquier combinación de "Calle/Av./Ruta/Paseo + nombre + número". El domicilio exacto se reserva siempre para la mensajería post-compra. Compartirlo pre-compra en ML viola TOS y puede causar suspensión de la cuenta.',
      '',
      '   Permitido y RECOMENDABLE para ayudar al cliente a evaluar el retiro:',
      '   - Zona / barrio / localidad / partido (ej. "estamos en Caseros", "zona de Caseros", "partido de Tres de Febrero")',
      '   - Referencias geográficas generales (ej. "a 15 cuadras del acceso oeste", "cerca de la estación", "zona oeste del GBA")',
      '   - El domicilio exacto (calle + número) se confirma por mensajería privada de MercadoLibre una vez concretada la compra',
      '',
      '   Ejemplo de respuesta correcta a "en qué zona están para retirar?":',
      '   "Estamos en la zona de Caseros, a 15 cuadras del acceso oeste. El domicilio exacto te llega por la mensajería de MercadoLibre una vez confirmada la compra."',
      '',
      '   NO incluyas nombre de calle + número en ningún mensaje pre-venta, ni siquiera si el cliente lo pide directamente. Si pide la dirección exacta: "Te paso el domicilio exacto por la mensajería privada de MercadoLibre apenas confirmes la compra."',
      '',
      '2. NUNCA redirijas al cliente fuera de MercadoLibre para comprar, consultar o ver el catálogo. Prohibido decir:',
      '   - "está en la web", "en nuestra web", "en nuestra página", "nuestra tienda online", "nuestra TiendaNube"',
      '   - "podés comprar ahí y retirar en el local"',
      '   - "ver el catálogo completo en…" (la única tienda existente para este cliente es nuestro perfil de MercadoLibre)',
      '   - Cualquier sugerencia de visitar otro sitio web para ver más productos',
      '   Si el cliente quiere ver más productos: "Tenemos más en nuestro perfil de tienda dentro de MercadoLibre: https://www.mercadolibre.com.ar/tienda/servifibras"',
      '',
      '3. Si el cliente pide hablar con alguien, contactar al vendedor, o un canal alternativo:',
      '   → Respondé textualmente: "Por acá te respondemos todo. Contame qué necesitás y lo resolvemos en este chat."',
      '   NUNCA improvisar variantes tipo "le aviso al asesor", "le paso el dato al equipo", "alguien del equipo te atiende", "te responden enseguida" — esas frases prometen una segunda vuelta que en ML no podemos garantizar. Usá la línea canónica exacta y avanzá invitando al cliente a contar la consulta.',
      '   NUNCA: "escribinos por WhatsApp", "mandanos un mail", "entrá a nuestra web".',
      '',
      '4. UNA SOLA respuesta consolidada por pregunta. MercadoLibre permite UNA respuesta a cada pregunta del cliente — si el cliente preguntó varias cosas a la vez, contestá todo junto en el mismo mensaje. Nunca digas "después te paso", "te confirmo más tarde" ni "te respondo en otro mensaje".',
      '',
      '5. Contexto de publicación. La pregunta viene de una publicación específica de ML. Respondé en ese contexto. Si el cliente pregunta por un producto que claramente no corresponde a la publicación que está consultando:',
      '   → "Para ese producto te conviene la publicación específica. La encontrás en nuestro perfil de tienda: https://www.mercadolibre.com.ar/tienda/servifibras"',
      '   NUNCA mandes el cliente fuera de ML para encontrarla.',
      '',
      '5.B ⚠️ LA PUBLICACIÓN ES EL PRODUCTO — NUNCA PIDAS QUE EL CLIENTE LO IDENTIFIQUE.',
      '   El bloque "PUBLICACIÓN ACTUAL" arriba ya te dice exactamente qué producto está mirando el comprador (título, descripción, atributos, precio, presentación). Cuando el cliente hace una pregunta — aunque parezca genérica ("cuánto tarda en secar?", "¿es dieléctrico?", "¿sirve para X?", "cuánto rinde?") — asumí que está preguntando POR ESE PRODUCTO de esta publicación, y respondé con los datos específicos del producto que ya tenés en contexto.',
      '   PROHIBIDO terminantemente preguntar al cliente cosas como:',
      '     - "¿Qué producto estás usando?"',
      '     - "¿Es resina epoxi, resina poliéster o silicona?"',
      '     - "¿Qué resina / qué silicona / qué pegamento tenés?"',
      '     - "Necesito saber qué producto antes de responder"',
      '     - Cualquier variante donde le pedís al cliente que identifique el producto que vos ya ves arriba en el contexto.',
      '   El comprador eligió esta publicación, abrió esta publicación, y está preguntando ACÁ — implícitamente está preguntando por ESTE producto. Tu trabajo es responder específico para ESTE producto, no pedirle que lo nombre.',
      '   Caso real (Marcos 2026-06-06): publicación "Resina Cristal Epoxi 4l con filtro UV". Comprador preguntó "cuánto tiempo se puede trabajar sin que seque?". El agente respondió "¿Es resina epoxi, poliéster o silicona?" — esa es exactamente la forma de error que no puede volver a aparecer. La respuesta correcta hubiera sido: "El tiempo de trabajo de la Resina Cristal Epoxi de esta publicación es de [X] minutos antes de empezar a gelificar a temperatura ambiente. Si la trabajás en capas finas tenés más margen; en volumen grande te conviene cortarla en tandas." — específico para el producto de la publicación, sin pedirle al cliente que identifique nada.',
      '',
      '6. Tono ML: más formal que en WhatsApp, respuesta completa, sin emojis, sin abreviaturas de chat. El comprador puede no conocer la marca — explicá lo justo para que entienda.',
      '',
      '7. PREGUNTAS DE PUBLICACIÓN = ONE-SHOT, NO CONVERSACIONAL. Cada pregunta del cliente en una publicación es un Q&A independiente: el cliente le pregunta A LA PUBLICACIÓN, no al negocio. Tenés UNA sola oportunidad de respuesta, cubrila completa.',
      '   - Resolvé la pregunta en este mensaje. Anticipá la info que el cliente probablemente necesite después (uso, cantidad, presentación, plazo, compatibilidad) en la misma respuesta — no la dejes para una segunda vuelta.',
      '   - PROHIBIDO terminar con pregunta abierta de conversación: "¿En qué te puedo ayudar?", "¿Tenés alguna duda más?", "Cualquier consulta avisame", "Quedo a disposición", "¿Hay algo más?", "¿Para qué proyecto la necesitás?", "¿Qué cantidad necesitás?" como cierre.',
      '   - PROHIBIDO ABSOLUTAMENTE prometer una respuesta o contacto futuro: "te paso con un asesor", "el equipo te responde", "te contactamos a la brevedad", "un asesor te confirma", "te respondemos en breve", "alguien del equipo te contacta", "te derivamos con un asesor", "más tarde te paso/confirmo". El comprador puede no volver a abrir la pregunta — no hay segunda vuelta. Marcos 2026-06-01: "el agente tiene que empezar y terminar la consulta en el mismo sitio". Si la respuesta requiere datos que no podés dar (cotización a medida para volumen, condición comercial especial), redirigí a la publicación específica del producto en ML en vez de prometer un contacto humano.',
      '   - PERMITIDO cerrar con una invitación CONDICIONAL específica que oriente hacia la siguiente decisión — p. ej. "Si tu pieza supera los X cm, conviene la presentación de Y kg." o "Si me contás el volumen que vas a trabajar, te oriento mejor sobre la presentación." Eso es información útil, no una pregunta abierta.',
      '   - Mensajería privada post-venta (el cliente ya compró y te escribe por DM): sí es conversacional, ahí podés cerrar con pregunta abierta como en WhatsApp.',
      '',
      '8. ⚠️ REGLA CRÍTICA — NUNCA DESCARTÁS EL PRODUCTO SIN OFRECER ALTERNATIVA CON LINK ⚠️',
      '   Si en tu respuesta vas a decir cualquiera de estas cosas:',
      '     - "no es la indicada", "no es la adecuada", "no es la recomendada"',
      '     - "no sirve para", "no es para", "no aplica", "no es lo ideal"',
      '     - "necesitás otra resina / otro producto / otra presentación"',
      '     - "para eso te conviene", "para ese uso usá", "lo correcto sería"',
      '   ENTONCES TENÉS QUE INCLUIR SÍ O SÍ:',
      '     (a) primero, llamá a buscar_producto con palabras clave del uso real ("laminación fibra carbono", "refuerzo estructural", "pintura de piso", "porcelanato líquido", "pegamento PRFV", etc.). Si la primera búsqueda no encuentra, probá variantes (sinónimos, categorías más amplias).',
      '     (b) en la respuesta, el "link ML:" del producto alternativo que devolvió la herramienta. Formato literal: "Para [uso] te conviene [nombre del producto]: [URL articulo.mercadolibre.com.ar/MLA-...]". Sin la URL, la respuesta queda incompleta.',
      '     (c) si después de 2 búsquedas la herramienta no devuelve algo relevante, INCLUÍ el link al perfil de tienda: https://www.mercadolibre.com.ar/tienda/servifibras — esto es el último recurso, NO el predeterminado.',
      '   PROHIBIDO terminar una respuesta que descarta el producto consultado sin AL MENOS uno de los dos links arriba. La pregunta es una oportunidad de venta: un "no" sin alternativa con link es una venta perdida y Marcos lo va a marcar como error.',
      '   Marcos 2026-06-03 (caso real que disparó esta regla): un comprador preguntó por reparación de paletas de pádel con fibra de carbono sobre la publicación de resina cristal de altos espesores. El agente respondió "esa resina no es la indicada, necesitás una resina de laminación" (correcto en el qué) pero SIN incluir ningún link a la publicación de la resina de laminación — eso es exactamente el modo en que se pierden ventas. Repetirlo no es opción.',
      '',
      'Violar cualquiera de estas reglas puede causar suspensión de la cuenta de ServiFibras en MercadoLibre. Estas reglas no son negociables ni con argumento del cliente. Si dudás entre redirigir al cliente o contestar acá, contestá acá.',
    ].join('\n');
  }
  return null;
}

// Configuration table key for the in-DB Lucas prompt override. When this
// row exists its `value` overrides the on-disk LUCAS_PROMPT_PATH file —
// admin edits via /admin/configuration/lucas-prompt land here so the
// next continueConversation() picks them up after a hot reload, no
// server restart, no AnyDesk session.
const LUCAS_PROMPT_CONFIG_KEY = 'lucas_prompt';

/**
 * Strip markdown formatting that doesn't render in WhatsApp / Messenger
 * / IG DMs (the actual customer channels). Idempotent and conservative:
 * we only touch the four patterns Marcos flagged on 2026-05-14 — bold,
 * headers, horizontal rules, redundant escapes. Plain links, line
 * breaks, and currency symbols stay untouched so price replies survive.
 */
/**
 * Strip decorative emojis from agent replies. Marcos's complaint #3 on
 * 2026-05-14: "🏊 🚤 🚗 🏠 🙌 😊 💪 — el prompt dice sin emojis decorativos".
 * The prompt asks for this, but Claude still occasionally emits a thumbs-up
 * to a "gracias" or a checkmark before a list — strip on the way out so
 * the rule doesn't depend on model discretion.
 *
 * We allow exactly one mark — "→" (U+2192) — because it functions as a
 * typographic bullet/arrow in the catalog format ("SKU: X — $Y → URL").
 * Everything else in the emoji blocks goes.
 *
 * Returns the cleaned string and a flag indicating whether the result is
 * now effectively empty (≤ 2 chars after trim). Callers can use that to
 * substitute a fallback acknowledgement instead of sending nothing.
 */
function stripDecorativeEmoji(s: string): { text: string; emptied: boolean } {
  if (!s) return { text: s, emptied: false };
  // Match a wide swath of Unicode emoji blocks. Keep "→" (U+2192) and the
  // catalog/list bullet hyphens untouched.
  const EMOJI = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{2691}\u{2693}-\u{27BF}]/gu;
  const cleaned = s.replace(EMOJI, '').replace(/\s+/g, (m) => m.includes('\n') ? m : ' ').trim();
  return { text: cleaned, emptied: cleaned.length <= 2 };
}

function stripMarkdownForChat(s: string): string {
  if (!s) return s;
  // Strip lines that look like Claude leaked system-prompt structure
  // into the customer-facing reply. Observed leaks on 2026-05-14 in the
  // ML sandbox: a trailing "PROMPT: [SYSTEM PROMPT]" and a "PROMPT: Por
  // favor responde SOLO en español rioplatense...". Drop any line that
  // BEGINS with "PROMPT:" / "[SYSTEM" / "[INSTRUCTION" / "INSTRUCTION:"
  // / "SYSTEM:" — these are not things a real reply should contain.
  const stripPromptLeaks = (txt: string): string =>
    txt
      .split('\n')
      .filter(
        (ln) =>
          !/^\s*(prompt|system|instruction)\s*:/i.test(ln) &&
          !/^\s*\[\s*(system|instruction|prompt)/i.test(ln),
      )
      .join('\n');

  return stripPromptLeaks(s)
    // Strip ATX headers ("### Pintura para piletas" → "Pintura para piletas").
    // Run before bold so a header that wraps a bolded run cleans both.
    .replace(/^#{1,6}\s+/gm, '')
    // Strip horizontal-rule separators on their own line.
    .replace(/^\s*---+\s*$/gm, '')
    // Bold + italics — drop the markers, keep the text. Handle the
    // double-asterisk case before the single-asterisk one so we don't
    // turn `**x**` into `*x*` and stop.
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Single-asterisk / single-underscore italics ONLY when they wrap
    // text on both sides (avoid matching standalone `*` bullets if
    // Claude ever uses them — bullets stay readable in WhatsApp anyway).
    .replace(/(?<![\w*])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, '$1')
    .replace(/(?<![\w_])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, '$1')
    // Collapse three+ newlines (from removed `---` lines) to two.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

import { IAIService } from '../../use-cases/ai/ai.interface';
import { AIConversation } from '../../domain/entities/ai-message.entity';
import { KnowledgeRepository } from '../repositories/knowledge.repository';
import { PricingCalculatorService } from '../pricing/pricing-calculator.service';
import { LaminadosCotizadorService } from '../pricing/laminados-cotizador.service';
import { ProductCatalogService } from '../admin/product-catalog.service';
import { BudgetExceededError, ClaudeBudgetService } from './claude-budget.service';
import { ConversationStyleService } from './conversation-style.service';
import { CustomerContextService } from './customer-context.service';
import { QuickReplyService } from '../admin/quick-reply.service';

@Injectable()
export class ClaudeService implements IAIService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly isConfigured: boolean;
  private readonly prisma = new PrismaClient();
  private knowledgeBaseContext: string | null = null;
  // Whitelist of real, currently-active product URLs from the catalog.
  // Used by the post-response URL filter to strip any link Claude
  // hallucinates (a "plausible" slug that doesn't actually map to a
  // TiendaNube product). Refreshed alongside `knowledgeBaseContext`
  // so the filter always reflects the catalog the agent saw.
  private validCatalogUrls: Set<string> = new Set();
  // Parallel map: TiendaNube product URL → MercadoLibre article URL,
  // for every product where both exist. Used by the ML output scrubber
  // to swap a TN URL the agent emitted for the per-product article
  // permalink. Refreshed alongside `validCatalogUrls`.
  private catalogUrlToMlPermalink: Map<string, string> = new Map();
  // Source-of-truth flag for the currently-loaded Lucas prompt:
  //   'db'   — admin-edited in the panel, stored in Configuration table
  //   'file' — fallback to the on-disk LUCAS_PROMPT_PATH
  //   'none' — no prompt loaded (path missing AND no DB row); short
  //            generic behaviour, surfaced in /health for visibility.
  private lucasPromptSource: 'db' | 'file' | 'none' = 'none';
  private lucasPromptUpdatedAt: Date | null = null;
  // The Lucas v5 system prompt — agent identity, tone, scope, reply
  // protocol. Loaded from LUCAS_PROMPT_PATH at startup so Marcos can
  // edit the file and restart the backend without a code change.
  // Layered ABOVE the knowledge base / catalog because identity must
  // anchor before facts; the catalog block reiterates "no inventes
  // SKUs/precios" so the two reinforce each other.
  private lucasPrompt: string | null = null;

  constructor(
    private readonly knowledgeRepo: KnowledgeRepository,
    private readonly pricingCalculator: PricingCalculatorService,
    private readonly productCatalog: ProductCatalogService,
    private readonly budget: ClaudeBudgetService,
    private readonly conversationStyle: ConversationStyleService,
    private readonly laminadosCotizador: LaminadosCotizadorService,
    private readonly customerContext: CustomerContextService,
    // Marcos 2026-06-18: librería de respuestas rápidas — chips
    // reusables que el operador curó. @Optional para que tests viejos
    // que arman el ClaudeService sin contenedor sigan funcionando.
    @Optional() private readonly quickReplies?: QuickReplyService,
  ) {
    // ✅ RULE 1: All config from .env, never hardcoded
    const apiKey = process.env.CLAUDE_API_KEY;
    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

    if (!apiKey || apiKey === 'sk-ant-your-api-key-here') {
      this.logger.warn(
        '⚠️  CLAUDE_API_KEY not configured. Service will start but API calls will fail.',
      );
      this.logger.warn('   Add your API key to .env: CLAUDE_API_KEY=sk-ant-...');
      this.client = null;
      this.isConfigured = false;
    } else {
      this.client = new Anthropic({ apiKey });
      this.isConfigured = true;
      this.logger.log(`✅ Claude Service initialized with model: ${this.model}`);
    }

    // Load knowledge base + Lucas v5 prompt asynchronously. Both are
    // best-effort: a missing prompt file falls back to the previous
    // short generic prompt so the service still boots.
    this.loadKnowledgeBase();
    this.loadLucasPrompt();
  }

  /**
   * Resolve the active Lucas system prompt. Priority order:
   *   1) Configuration row `lucas_prompt` (admin-edited via the panel)
   *   2) LUCAS_PROMPT_PATH file on disk (the canonical default Marcos
   *      gave us; ships with the codebase, never modified at runtime)
   *   3) Null — `continueConversation` falls back to a short generic
   *      system prompt so a misconfigured env doesn't take down customer
   *      replies, but logs loud enough that ops notices.
   *
   * The source + timestamp are kept around so the admin UI can show
   * "currently running: file (default) — never edited" vs "currently
   * running: db (last edited 2026-05-14 22:30 by admin@servifibras)".
   */
  private async loadLucasPrompt(): Promise<void> {
    // Try DB first.
    try {
      const row = await this.prisma.configuration.findUnique({
        where: { key: LUCAS_PROMPT_CONFIG_KEY },
      });
      if (row && row.isActive && row.value && typeof (row.value as any).content === 'string') {
        const content = ((row.value as any).content as string).trim();
        if (content.length > 0) {
          this.lucasPrompt = content;
          this.lucasPromptSource = 'db';
          this.lucasPromptUpdatedAt = row.updatedAt ?? null;
          this.logger.log(
            `✅ Lucas system prompt loaded from DB (${content.length} chars, updated ${row.updatedAt?.toISOString()})`,
          );
          return;
        }
      }
    } catch (err: any) {
      // DB read failure is non-fatal — fall through to file. Logged at
      // warn so a missing migration shows up loud in journalctl.
      this.logger.warn(`Lucas prompt DB read failed: ${err?.message ?? err}; falling back to file`);
    }

    // Fall back to file.
    const path = process.env.LUCAS_PROMPT_PATH || '';
    if (!path) {
      this.logger.warn('LUCAS_PROMPT_PATH not set and no DB override; falling back to short generic prompt');
      this.lucasPrompt = null;
      this.lucasPromptSource = 'none';
      this.lucasPromptUpdatedAt = null;
      return;
    }
    try {
      const raw = await fs.readFile(path, 'utf8');
      this.lucasPrompt = raw.trim();
      this.lucasPromptSource = 'file';
      this.lucasPromptUpdatedAt = null;
      this.logger.log(`✅ Lucas system prompt loaded from file (${this.lucasPrompt.length} chars from ${path})`);
    } catch (err: any) {
      this.logger.error(`Failed to read Lucas prompt from ${path}: ${err.message}`);
      this.lucasPrompt = null;
      this.lucasPromptSource = 'none';
      this.lucasPromptUpdatedAt = null;
    }
  }

  async reloadLucasPrompt(): Promise<void> {
    await this.loadLucasPrompt();
  }

  /**
   * Operator-facing snapshot of the currently-loaded prompt. Used by
   * the admin panel's prompt-editor screen — populates the textarea on
   * load and the status caption ("running from DB, last edit 14/5
   * 22:30") above the editor.
   */
  getLucasPromptSnapshot(): {
    content: string | null;
    source: 'db' | 'file' | 'none';
    updatedAt: string | null;
    length: number;
  } {
    return {
      content: this.lucasPrompt,
      source: this.lucasPromptSource,
      updatedAt: this.lucasPromptUpdatedAt ? this.lucasPromptUpdatedAt.toISOString() : null,
      length: this.lucasPrompt?.length ?? 0,
    };
  }

  /**
   * Persist a new Lucas prompt to the Configuration table and reload
   * the in-memory copy so the next reply uses it. The admin controller
   * delegates here so the writing + reload + audit chain is atomic
   * from the caller's perspective.
   *
   * Returns the resulting snapshot for the UI to render without a
   * follow-up fetch.
   */
  async saveLucasPrompt(
    content: string,
    actor?: { userId?: string | null },
  ): Promise<{ source: 'db'; updatedAt: string; length: number }> {
    const trimmed = (content || '').trim();
    if (!trimmed) {
      throw new Error('Lucas prompt cannot be empty');
    }
    // Reasonable cap — Anthropic's system-prompt limit is generous but
    // anything over ~100 KB is almost certainly a paste-disaster. The
    // current default v5 is 33 KB, so 200 KB is a 6× safety margin.
    if (trimmed.length > 200_000) {
      throw new Error('Lucas prompt too large (max 200 KB)');
    }
    const value: any = { content: trimmed };
    if (actor?.userId) value.lastEditedBy = actor.userId;

    const row = await this.prisma.configuration.upsert({
      where: { key: LUCAS_PROMPT_CONFIG_KEY },
      update: { value, isActive: true },
      create: {
        type: 'AI',
        key: LUCAS_PROMPT_CONFIG_KEY,
        value,
        description: 'System prompt that defines the Lucas agent identity, tone, scope, and reply protocol. Overrides the on-disk LUCAS_PROMPT_PATH file when present.',
        isActive: true,
      },
    });

    // Hot-reload so the next continueConversation() call picks up the
    // new prompt without waiting for a server restart.
    await this.loadLucasPrompt();

    return {
      source: 'db',
      updatedAt: row.updatedAt.toISOString(),
      length: trimmed.length,
    };
  }

  /**
   * Drop the DB override, falling back to the on-disk default. Used by
   * a "Restablecer al original" button in the prompt editor so Marcos
   * can revert without copy-pasting the default file content back in.
   */
  async resetLucasPrompt(): Promise<{ source: 'file' | 'none'; length: number }> {
    await this.prisma.configuration.deleteMany({
      where: { key: LUCAS_PROMPT_CONFIG_KEY },
    });
    await this.loadLucasPrompt();
    return {
      source: this.lucasPromptSource === 'db' ? 'file' : this.lucasPromptSource,
      length: this.lucasPrompt?.length ?? 0,
    };
  }

  private async loadKnowledgeBase(): Promise<void> {
    try {
      // Catalog is NO LONGER dumped into the system prompt — the agent
      // calls the `buscar_producto` tool on-demand instead. The active
      // URL whitelist still loads so the post-response filter can
      // strip fabricated links. The free-form KB block stays in the
      // prompt because it's small, mostly static, and worth caching.
      const [kb, urls, mlMap] = await Promise.all([
        this.knowledgeRepo.getFormattedForAI(),
        this.productCatalog.getActiveCatalogUrls().catch(() => new Set<string>()),
        this.productCatalog.getCatalogUrlToMlPermalinkMap().catch(() => new Map<string, string>()),
      ]);
      this.knowledgeBaseContext = kb && kb.length > 0 ? kb : null;
      this.validCatalogUrls = urls;
      this.catalogUrlToMlPermalink = mlMap;
      this.logger.log(
        `✅ KB loaded; ${urls.size} valid product URLs whitelisted, ${mlMap.size} with ML permalink (catalog now via tool calling)`,
      );
    } catch (error) {
      this.logger.error('Failed to load knowledge base', error);
      this.knowledgeBaseContext = null;
      this.validCatalogUrls = new Set();
      this.catalogUrlToMlPermalink = new Map();
    }
  }

  /**
   * Re-pull KB + catalog from disk. Called by the admin layer after
   * Marcos edits the catalog so a freshly-saved product appears in the
   * AI context without a service restart.
   */
  /**
   * Post-response defence against URL hallucination. Scans the agent's
   * reply for http(s) URLs and, for any that isn't in the catalog's
   * whitelist, replaces the URL with a literal "[link no disponible]"
   * marker. Marcos's 2026-05-18 brief: the agent improvised plausible-
   * looking slugs (e.g. `/productos/resina-epoxi-cristal`) that don't
   * map to real products. The base v7 prompt forbids this, but Claude
   * still drifts sometimes — this is the belt-and-suspenders that
   * guarantees no fabricated link reaches the customer.
   *
   * Idempotent + cheap. Logs a warning whenever a fabricated URL is
   * caught so we can monitor the rate.
   */
  private dropFabricatedUrls(
    text: string,
    channel?: Channel,
  ): { text: string; dropped: number } {
    if (!text) return { text, dropped: 0 };
    let dropped = 0;
    let cleaned = text;

    // Universal scrub: internal test markers must never reach the
    // customer. The prompt-editor probe v1 historically leaked
    // "E2E-MARKER-..." into live replies (fixed in v2 by removing the
    // mutation), and the channel-toggle probe injects MARKER-ON /
    // MARKER-BACK strings as customer messages — if those ever echo
    // back through the agent (history poisoning, prompt drift), strip
    // them defensively here.
    const INTERNAL_MARKER_RE_OUT =
      /\b(?:E2E-MARKER|MARKER-(?:ON|OFF|BACK|STILL-OFF))[- ]?[A-Za-z0-9_-]*\b/gi;
    cleaned = cleaned.replace(INTERNAL_MARKER_RE_OUT, (raw) => {
      dropped++;
      this.logger.warn(`Internal marker stripped from agent reply: "${raw}"`);
      return '';
    });

    // Pass 1 — full URLs with protocol. Strip anything that isn't a
    // catalog row OR an explicitly-whitelisted ML/internal URL.
    //
    // The ML store profile (https://www.mercadolibre.com.ar/tienda/servifibras)
    // is whitelisted on every channel — Marcos's 2026-06-01 ask was
    // for the agent to actually include the link in cross-publication
    // redirects (ML permits internal mercadolibre.com.ar links). We
    // also let any mercadolibre.com.ar / mercadolibre.com URL through
    // since those are platform-internal regardless of channel.
    const ML_INTERNAL_URL_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*mercadolibre\.com(?:\.ar)?(?:\/|$)/i;
    if (this.validCatalogUrls.size > 0) {
      cleaned = cleaned.replace(/\bhttps?:\/\/[^\s<>\)\]"',]+/gi, (raw) => {
        const trimmed = raw.replace(/[.,;:!?]+$/, '');
        if (
          this.validCatalogUrls.has(trimmed) ||
          this.validCatalogUrls.has(trimmed + '/') ||
          this.validCatalogUrls.has(trimmed.replace(/\/$/, '')) ||
          ML_INTERNAL_URL_RE.test(trimmed)
        ) {
          return raw;
        }
        dropped++;
        this.logger.warn(`Fabricated URL dropped from agent reply: ${trimmed}`);
        return '[link no disponible — pedímelo y te lo paso del catálogo]';
      });
    }

    // Pass 2 — every external contact channel on MercadoLibre. The TOS
    // ban isn't only about URLs: it's about pulling the buyer off the
    // platform via *any* external pathway. Marcos's 2026-05-18 fire
    // was the agent saying "tiendaservifibras.com" without https://
    // (the pass-1 regex misses that), and earlier conversations from
    // 2026-05-15 had "11 3588 0083" / "@gmail.com" / "WhatsApp" floating
    // around the assistant history. Each leak on its own is enough for
    // a suspension, so we cover all four:
    //
    //   - store domain (with or without protocol, with or without path)
    //   - AR mobile phone numbers (the 11 NNNN NNNN pattern Marcos's
    //     real chip uses + permissive +54/9 prefixes)
    //   - email addresses
    //   - bare "WhatsApp" mentions ("escribinos por whatsapp")
    //
    // Webchat is unaffected — those channels are allowed to share the
    // store URL, WhatsApp, etc.
    if (channel === Channel.MERCADOLIBRE) {
      // Canonical ML store URL — internal mercadolibre.com.ar URL,
      // permitted by ML TOS. Marcos's 2026-06-01 ask: when the agent
      // redirects the buyer off the current publication's link, give
      // them the actual ML store URL so they can click directly,
      // instead of the prior link-less phrase.
      const ML_STORE_URL =
        process.env.ML_STORE_URL ||
        'https://www.mercadolibre.com.ar/tienda/servifibras';
      const ML_DEFLECT = `lo encontrás en nuestro perfil de tienda: ${ML_STORE_URL}`;
      const EXTERNAL_DOMAIN_RE =
        /\b(?:https?:\/\/)?(?:tienda)?servifibras\.com(?:\.ar)?(?:\/[^\s<>\)\]"',]*)?/gi;
      const PHONE_RE = /\b(?:\+?54\s*)?9?\s*11[\s.-]*\d{4}[\s.-]*\d{4}\b/g;
      const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
      const WHATSAPP_RE = /\bwhats?\s*app\b/gi;
      cleaned = cleaned.replace(EXTERNAL_DOMAIN_RE, (raw) => {
        // If the TN URL the agent emitted corresponds to a product
        // that has a ML article URL on file, swap the TN URL for the
        // per-product MLA permalink (matches Prometheo's behaviour).
        // Tolerant URL normalisation: try the raw URL, with/without
        // trailing slash, and with explicit https:// prefix.
        const candidates = [
          raw,
          raw.replace(/\/$/, ''),
          raw + '/',
          raw.startsWith('http') ? raw : `https://${raw}`,
        ];
        for (const c of candidates) {
          const mlUrl = this.catalogUrlToMlPermalink.get(c);
          if (mlUrl) {
            this.logger.debug(`ML scrub: swapped TN URL for per-product MLA permalink (${c} → ${mlUrl})`);
            return mlUrl;
          }
        }
        // No per-product permalink — fall back to the generic store
        // deflect line (still includes the ML store URL).
        dropped++;
        this.logger.warn(`ML scrub: dropped external-domain "${raw}" (no per-product ML permalink available)`);
        return ML_DEFLECT;
      });
      cleaned = cleaned.replace(PHONE_RE, (raw) => {
        dropped++;
        this.logger.warn(`ML scrub: dropped phone number "${raw}"`);
        return '[contacto fuera de MercadoLibre no disponible]';
      });
      cleaned = cleaned.replace(EMAIL_RE, (raw) => {
        dropped++;
        this.logger.warn(`ML scrub: dropped email "${raw}"`);
        return '[contacto fuera de MercadoLibre no disponible]';
      });
      cleaned = cleaned.replace(WHATSAPP_RE, () => {
        dropped++;
        this.logger.warn(`ML scrub: dropped WhatsApp mention`);
        return 'este chat de MercadoLibre';
      });
      // Exact-address scrub. Marcos's 2026-05-27 fire: agent gave
      // "Estamos en Martín de Álzaga 3634, Caseros (Tres de Febrero)..."
      // to a buyer asking "en qué zona están para retirar?". On ML the
      // exact street+number is the TOS-grade leak; zone-level info
      // ("zona de Caseros", "partido de Tres de Febrero") is actually
      // SALES-POSITIVE — helps the buyer evaluate the pickup before
      // committing (Marcos's 2026-05-28 clarification).
      //
      // Strategy: only catch the EXACT-LOCATION patterns. Bare
      // locality/partido names are allowed through. If exact street +
      // number is found, scrub THAT segment (not the whole reply) and
      // append the post-compra deferral so the message stays coherent.
      const ADDRESS_LEAK_DETECTORS: Array<{ name: string; re: RegExp }> = [
        { name: 'store street literal',  re: /\bMart[íi]n\s+de\s+[ÁA]lzaga(?:\s+\d{1,5})?\b/gi },
        { name: 'generic street + number', re: /\b(?:Calle|Av\.?|Avenida|Ruta|Paseo|Pje\.?|Pasaje)\s+[A-ZÁÉÍÓÚÑ][\w\s.'-]{2,40}?\s+\d{1,5}\b/gi },
      ];
      let leakDetected = false;
      for (const d of ADDRESS_LEAK_DETECTORS) {
        if (d.re.test(cleaned)) {
          d.re.lastIndex = 0;
          cleaned = cleaned.replace(d.re, '[domicilio exacto por mensajería de MercadoLibre tras la compra]');
          dropped++;
          leakDetected = true;
          this.logger.warn(`ML scrub: exact-address leak (${d.name}) replaced with post-compra deferral`);
        }
      }
      // If we scrubbed an exact address mid-sentence the result may
      // still read oddly; the placeholder is informative enough on its
      // own that no extra rewriting is needed.
      void leakDetected;
    }

    return { text: cleaned, dropped };
  }

  /**
   * Enforce the per-message length budget Marcos asked for ("máx 450
   * caracteres por mensaje"). The agent's reply uses `\n\n` to mark
   * where one message ends and the next begins — adapters then send
   * each block as a separate bubble in WhatsApp / Webchat. Here we:
   *
   *   1. Split on `\n\n` boundaries into candidate bubbles.
   *   2. If any single bubble still exceeds the budget, soft-split it
   *      on `\n` (single newline) and then sentence boundaries. We
   *      never cut mid-word.
   *   3. Cap at 3 bubbles total to keep a single response from turning
   *      into a wall of messages. Excess gets folded into the last
   *      bubble with an ellipsis if it still fits, otherwise dropped.
   *   4. For MercadoLibre: rejoin into ONE bubble (the platform only
   *      allows a single response per Q&A) and clamp to the budget by
   *      keeping the first product/answer block — the rest is lost
   *      because there's no second-message channel on ML.
   *
   * Pure string transform — no side effects, easy to unit-test.
   * Budget comes from env so Marcos can dial it without a deploy.
   */
  /**
   * Strip stalling phrases. Marcos's anti-stalling rule (5/18): the agent
   * must NEVER promise future action it can't deliver — "dame un segundo
   * que te busco", "te confirmo en un toque", "ya te paso". On 2026-05-22
   * we caught a live ML reply ending "dame un momento y te lo informo por
   * acá" — same disease, different word. The narrow regex in my probe
   * missed it, so enforce server-side with a broader pattern.
   *
   * The replacement is a polite defer-to-team line. Empty replacement
   * (just deleting the phrase) leaves a stub sentence that reads worse
   * than the original — the defer keeps the reply coherent.
   */
  private stripStallingPhrases(text: string, channel?: Channel): string {
    if (!text) return text;
    const STALL_RES: Array<{ name: string; re: RegExp }> = [
      { name: 'dame un X', re: /\bdame\s+un\s+(?:segundo|momento|toque|ratito|rato)\b[^.!?\n]*[.!?]?/gi },
      { name: 'ya te paso/informo', re: /\bya\s+te\s+(?:paso|informo|confirmo|aviso|digo|mando|envío|busco)\b[^.!?\n]*[.!?]?/gi },
      { name: 'te confirmo en/después', re: /\bte\s+(?:confirmo|paso|informo|aviso|digo|mando|envío)\s+(?:en\s+un\s+(?:rato|momento|toque)|después|más\s+tarde|enseguida)\b[^.!?\n]*[.!?]?/gi },
      { name: 'dejame ver/chequear', re: /\bdejame\s+(?:ver|chequear|revisar|consultar|buscar|confirmar)\b[^.!?\n]*[.!?]?/gi },
      { name: 'aguantame un X', re: /\baguant[áa]me\s+un\s+(?:segundo|momento|toque|ratito|rato)\b[^.!?\n]*[.!?]?/gi },
      { name: 'te lo informo por acá', re: /\bte\s+lo\s+(?:informo|paso|aviso|confirmo|mando)\s+(?:por\s+ac[áa]|despu[eé]s|m[áa]s\s+tarde|enseguida)\b[^.!?\n]*[.!?]?/gi },
    ];
    let cleaned = text;
    let hit = false;
    for (const r of STALL_RES) {
      if (r.re.test(cleaned)) {
        hit = true;
        cleaned = cleaned.replace(r.re, '');
        this.logger.warn(`Stalling phrase stripped: ${r.name}`);
      }
    }
    // ML pre-venta also bans any "asesor / equipo te confirma / a la
    // brevedad" defer language at the surface — Marcos's 2026-06-01
    // rule: a ML Q&A is one-shot, the buyer may never re-open. We strip
    // those phrases too so the reply doesn't promise a second turn.
    const isML = channel === Channel.MERCADOLIBRE;
    if (isML) {
      const ML_HANDOFF_RES: Array<{ name: string; re: RegExp }> = [
        { name: 'te paso con un asesor', re: /\bte\s+(?:paso|conecto|derivo|comunico)\s+con\s+(?:un\s+)?asesor(?:\s+del\s+equipo)?[^.!?\n]*[.!?]?/gi },
        { name: 'un asesor del equipo', re: /\bun?\s+asesor(?:\s+del\s+equipo)?[^.!?\n]*?(?:confirma|responde|te\s+contacta|se\s+contacta|coordina)[^.!?\n]*[.!?]?/gi },
        { name: 'el equipo te contacta', re: /\bel\s+equipo\s+(?:te\s+)?(?:contacta|responde|se\s+pone\s+en\s+contacto)[^.!?\n]*[.!?]?/gi },
        { name: 'a la brevedad', re: /\b(?:a\s+la\s+brevedad|en\s+breve|en\s+un\s+rato|m[áa]s\s+tarde\s+te)[^.!?\n]*[.!?]?/gi },
        // 2026-06-01: catch the softer hand-off variants the agent
        // started producing once "asesor" was banned — same concept:
        // "le paso el dato a la persona correcta del equipo y te
        // atienden". Same one-shot violation, different phrasing.
        { name: 'le paso el dato a la persona', re: /\b(?:le\s+paso|le\s+aviso|le\s+derivo|paso\s+el\s+dato)\s+(?:el\s+dato\s+)?a\s+(?:la\s+)?(?:persona|alguien|quien)[^.!?\n]*[.!?]?/gi },
        // 2026-06-04: "el precio final lo confirma X según el TC"
        // (price subject to confirmation) — same one-shot violation,
        // disguised as a rate hedge. Marcos: prices are final from
        // the cotizador, not pending operator confirmation.
        { name: 'el precio final lo confirma', re: /\bel?\s*precio\s+(?:final\s+)?(?:lo\s+)?(?:confirma|valida|chequea|revisa)[^.!?\n]*[.!?]?/gi },
        { name: 'sujeto a cambio/confirmación', re: /\b(?:sujeto|sujeta)\s+(?:a\s+)?(?:cambio|confirmaci[oó]n|revisi[oó]n)[^.!?\n]*[.!?]?/gi },
        // 2026-06-04: agent kept asking for the buyer's name "para
        // coordinar" — that's a one-shot violation (promises a second
        // turn). ML Q&A ends with the cotization; no follow-up CTA.
        { name: '¿me dejás tu nombre?', re: /¿?\s*me\s+(?:dejas|dej[áa]s|pas[áa]s)\s+tu\s+(?:nombre|tel[eé]fono|contacto|datos?)[^.!?\n]*\?/gi },
        { name: 'para coordinar / te coordino', re: /\b(?:para\s+coordinar|te\s+coordino|coordinamos|y\s+coordinamos|para\s+armar)[^.!?\n]*[.!?]?/gi },
        { name: 'para confirmar el pedido', re: /\bpara\s+(?:confirmar|cerrar|armar)\s+(?:el\s+)?(?:pedido|presupuesto|envío)[^.!?\n]*[.!?]?/gi },
        { name: 'alguien del equipo te atiende', re: /\balguien\s+del\s+equipo[^.!?\n]*?(?:te\s+(?:atiende|contacta|responde)|se\s+(?:contacta|pone))[^.!?\n]*[.!?]?/gi },
        { name: 'la persona correcta del equipo', re: /\b(?:la\s+persona\s+correcta|alguien\s+especializado)\s+(?:del\s+)?equipo[^.!?\n]*[.!?]?/gi },
        { name: 'te atienden rápido', re: /\bte\s+atienden\s+(?:r[áa]pido|enseguida|en\s+breve)[^.!?\n]*[.!?]?/gi },
        { name: 'pasamos a un humano', re: /\b(?:te\s+)?(?:paso|pasamos|paso\s+esta|derivamos|conectamos)\s+(?:con|a)\s+(?:un\s+)?humano[^.!?\n]*[.!?]?/gi },
        { name: 'le aviso al equipo', re: /\b(?:le|les)\s+(?:aviso|paso|comento|cuento)\s+al\s+(?:equipo|vendedor|asesor)[^.!?\n]*[.!?]?/gi },
        { name: 'y te responden', re: /\by\s+te\s+(?:responden|contactan|atienden|escriben)[^.!?\n]*[.!?]?/gi },
      ];
      for (const r of ML_HANDOFF_RES) {
        if (r.re.test(cleaned)) {
          hit = true;
          cleaned = cleaned.replace(r.re, '');
          this.logger.warn(`ML one-shot scrub: ${r.name}`);
        }
      }
    }
    if (!hit) return text;
    // If after stripping we orphaned a trailing connector / fragment,
    // tidy the end. Also drop orphan opening "¿" left behind when a
    // question got stripped mid-sentence ("$240.990. ¿" → "$240.990.").
    cleaned = cleaned
      .replace(/[\s,;]+$/g, '')
      .replace(/¿\s*$/g, '')
      .replace(/¿(?=\s*\n|\s*$)/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\.\s*\./g, '.')
      .trim();
    if (cleaned.length === 0) {
      // Empty after scrubbing: channel-aware fallback. On ML the buyer
      // gets a one-shot answer pointing at the product publication;
      // everywhere else the legacy asesor defer is OK.
      return isML
        ? 'Para detalles puntuales te conviene la publicación específica del producto en nuestro perfil de MercadoLibre.'
        : 'Te paso con un asesor del equipo para que te confirme los detalles exactos.';
    }
    // Append a clean defer line if the stripped reply doesn't already
    // end with one. On ML we do NOT append a defer (one-shot rule) — the
    // reply stands as-is.
    if (!isML) {
      const tail = cleaned.slice(-200).toLowerCase();
      if (!/asesor|equipo|coordinamos|confirmamos/.test(tail)) {
        cleaned += '\n\nSi necesitás el dato exacto, un asesor del equipo te confirma en breve.';
      }
    }
    return cleaned;
  }

  /**
   * ML personalised greeting + signoff (Marcos 2026-06-01). ML provides
   * the buyer's apodo with each question — every reply on the ML
   * channel must open "Hola {apodo}," and close "Un saludo, Lucas de
   * Servifibras." Other channels (WhatsApp, webchat, IG) keep their
   * existing tone — those are conversational, this is the one-shot
   * formal frame ML expects.
   *
   * Idempotent: if the agent's reply already starts with "Hola " (e.g.
   * because the prompt pushed it) we don't double-wrap; same for the
   * signoff. We also normalise the apodo (trim, strip a leading "@",
   * limit length so a hostile apodo can't blow up the bubble).
   */
  /**
   * Strip dollar / USD / blue-rate mentions from any outbound reply.
   * Marcos 2026-06-04: "El dolar es algo nuestro interno para tener en
   * cuenta a la hora de cotizar." The customer should only see pesos.
   * The prompt rule is the primary guard; this is the deterministic
   * backstop that fires when Claude (or a tool result) leaks USD into
   * the reply text. Patterns are conservative — we only strip
   * standalone phrases that contain the forbidden tokens, not legit
   * product names that happen to contain a number.
   */
  /**
   * Strip payment-method mentions ("transferencia bancaria", "por
   * transferencia", "contado", "efectivo", etc.) from outbound replies
   * on the MercadoLibre channel. Marcos 2026-06-04 (PM): MercadoLibre
   * flags any payment-method language as an attempt to canalize
   * payment off-platform, which is a TOS violation. We let the agent
   * keep computing internally as transferencia (the cotizator default)
   * but never surface the term to the buyer.
   */
  private stripPaymentMethodMentions(text: string, channel?: Channel): string {
    if (!text || channel !== Channel.MERCADOLIBRE) return text;
    let out = text;
    // "Pago: transferencia / pago en efectivo / pago contado" — strip
    // the WHOLE compound (including the leading "pago" word) before
    // individual qualifier passes touch them. Without this, removing
    // just "transferencia" leaves "pago " orphans like "(ya incluye
    // IVA, pago )" in the rendered reply.
    out = out.replace(/\bpago\s+(?:por\s+|en\s+|al\s+|como\s+|con\s+|por\s+medio\s+de\s+)?(?:transferencia(?:\s+bancaria)?|contado|efectivo|bancaria|tarjeta(?:\s+de\s+cr[eé]dito)?|d[eé]bito)\b/gi, '');
    // Inline qualifiers that precede or trail a price.
    out = out.replace(/\b(?:por\s+|en\s+|como\s+|modo\s+|forma\s+(?:de\s+pago\s+)?)?transferencia(?:\s+bancaria)?\b/gi, '');
    out = out.replace(/\b(?:al\s+|en\s+|por\s+|de\s+|modo\s+|forma\s+)?contado\b/gi, '');
    out = out.replace(/\b(?:en\s+|al\s+|por\s+|pago\s+en\s+)?efectivo\b/gi, '');
    // Parentheticals.
    out = out.replace(/\(\s*(?:transferencia(?:\s+bancaria)?|contado|efectivo|por\s+transferencia|pago[^)]*)\s*\)/gi, '');
    // "Modo de pago: X" lines.
    out = out.replace(/\bmodo\s+de\s+pago\s*[:\-]\s*[^\n.!?]*[.!?\n]?/gi, '');
    out = out.replace(/\bforma\s+de\s+pago\s*[:\-]\s*[^\n.!?]*[.!?\n]?/gi, '');
    // Clean up orphan "pago" / ", pago" / "(pago)" left by upstream strips.
    out = out.replace(/[,;]\s*pago\b\s*(?=[)\n.!?,;]|$)/gi, '');
    out = out.replace(/\bpago\b\s*\)/gi, ')');
    // Tidy: empty parens "()", trailing comma before ")", double spaces.
    out = out.replace(/\(\s*\)/g, '');
    out = out.replace(/,\s*\)/g, ')');
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').replace(/\s+([,.;])/g, '$1').trim();
    return out;
  }

  /**
   * Ensure ML laminate cotizations close with Marcos's exact phrase:
   * "La cotización por este medio es $X." If the agent didn't include
   * it (Claude phrasing variance), but the reply DOES contain a peso
   * amount AND mentions metros/m²/lámina/plancha (laminate signal),
   * append the line with the largest peso amount in the body.
   *
   * Conservative: only fires on ML channel, only when the reply looks
   * like a laminate quote. Skips replies that already have "por este
   * medio" in some form.
   */
  private ensureMlPorEsteMedioLine(text: string, channel?: Channel): string {
    if (!text || channel !== Channel.MERCADOLIBRE) return text;
    if (/por\s+este\s+medio/i.test(text)) return text;
    const isLaminate = /(?:l[áa]mina|plancha|panel|laminado|PRFV|metros?\s+lineales?|m²|m2)/i.test(text);
    if (!isLaminate) return text;
    // Find peso amounts; pick the largest as the canonical total.
    const matches = text.match(/\$\s*([\d.,]+)/g) || [];
    if (matches.length === 0) return text;
    const amounts = matches
      .map((m) => {
        const num = m.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.');
        return { raw: m.trim(), value: Number(num) };
      })
      .filter((m) => Number.isFinite(m.value) && m.value > 0)
      .sort((a, b) => b.value - a.value);
    if (amounts.length === 0) return text;
    const total = amounts[0].raw;
    return `${text.trim()}\nLa cotización por este medio es ${total}.`;
  }

  private stripDollarReferences(text: string): string {
    if (!text) return text;
    let out = text;
    // Strip whole sentences/lines that announce the rate or qualify
    // the price as "subject to the rate of the day". The prompt had
    // "Cotización blue del día $X/USD" baked in for a while; we also
    // need to catch agent-paraphrased variants like "el precio lo
    // confirma un asesor según el TC del día".
    out = out.replace(
      /(?:\s*(?:cotizaci[oó]n|tipo\s+de\s+cambio|T\.?\s*C\.?)(?:\s+blue)?(?:\s+del\s+d[ií]a)?[^.!?\n]*?(?:USD|U\$D|d[oó]lar)[^.!?\n]*?[.!?\n])/gi,
      '',
    );
    // Free-standing "según/al TC del día" or "(TC del día)" clauses
    // even when no USD literal appears in the same clause — Claude
    // sometimes drops "TC del día" alone. Also catches "TC de
    // referencia" / "TC actual" / parenthetical "(TC ...)".
    out = out.replace(/[^.!?\n]*\b(?:T\.?\s*C\.?|tipo\s+de\s+cambio)\s+(?:del\s+d[ií]a|actual|de\s+hoy|de\s+referencia|orientativ[oa])[^.!?\n]*[.!?\n]/gi, '');
    out = out.replace(/\(\s*T\.?\s*C\.?[^)]*\)/gi, '');
    // Stray "(450)" / "(1450)" parentheticals left after a partial
    // USD strip — if a 3-4 digit number sits alone in parens with no
    // currency/unit context, drop it. Avoid touching legit "(IVA
    // incluida)" or "(6 m²)" parentheticals (those have non-digit
    // content).
    out = out.replace(/\(\s*\d{3,4}\s*\)/g, '');
    // Strip per-pricing "USD X" / "U$D X" / "X USD" snippets inline.
    out = out.replace(/\bU\$?D?\s*\$?\s*\d[\d.,]*\s*(?:\/[a-zA-Z²2]+)?/g, '');
    out = out.replace(/\b\d[\d.,]*\s*U\$?D?\b/gi, '');
    // Strip leftover "(blue del día)" / "(blue)" parentheticals.
    out = out.replace(/\(\s*(?:blue|d[oó]lar(?:\s+blue)?|cotizaci[oó]n[^)]*|T\.?\s*C\.?[^)]*)\s*\)/gi, '');
    // Collapse double spaces left behind by the strips.
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
    return out;
  }

  /**
   * ML safety net: if the agent's reply discourages the publication's
   * product ("no es la indicada", "no sirve para", "necesitás otra
   * resina") and does NOT include any mercadolibre.com.ar URL, append
   * the storefront URL so the buyer still has a path back to our
   * catalog. The prompt rule (channelGuardrailBlock #8) is the primary
   * guard; this is the deterministic backstop that fires when Claude
   * gets terse and skips the link.
   *
   * Patterns triggering the fallback are conservative — we only fire
   * when the reply contains a clear "this is not for you" signal so we
   * don't append a redundant link to neutral product confirmations.
   */
  private ensureMlAlternativeLink(text: string, channel?: Channel): string {
    if (!text) return text;
    if (channel !== Channel.MERCADOLIBRE) return text;
    // Already has at least one mercadolibre.com.ar link → assume the
    // agent did the right thing and don't touch the response.
    if (/mercadolibre\.com\.ar/i.test(text)) return text;

    // Detect "no es para vos / no es lo indicado / no es la más adecuada"
    // framing. Patterns are intentionally permissive so any flavour of
    // "this isn't right for your use" trips the safety net.
    const discouragesProduct =
      /\bno\s+es\s+(la|el|lo)?\s*(más\s+|el\s+más\s+|la\s+más\s+|lo\s+más\s+)?(indicad|recomendad|adecuad|ideal|pensad|apropiad)/i.test(text) ||
      /\bno\s+(es|está|sirve|aplica|funciona)\s+para\b/i.test(text) ||
      /\bno\s+(sirve|funciona|aplica)\s+(para|en)/i.test(text) ||
      /\bnecesit[áa]s\s+(otra|otro|una|un)\s+(resina|producto|presentaci|fórmula|tipo)/i.test(text) ||
      /\bpara\s+(eso|ese\s+uso|esa\s+aplicación|tu\s+caso|reparación|reparar|laminación)\s+(te\s+conviene|conviene|usá|necesit|la\s+(resina|indicada))/i.test(text) ||
      /\blo\s+(correcto|recomendado|ideal)\s+(sería|es)\b/i.test(text) ||
      /\b(esta|este|esa|ese)\s+(resina|producto|publicación)\s+(no\s+(es|sirve|está)|está\s+pensad)/i.test(text) ||
      /\bla\s+(resina|publicación)\s+(consultada|de\s+esta\s+publicación)\s+(no|está\s+pensad)/i.test(text) ||
      // "la resina indicada es X" — Claude phrases the redirect this
      // way too. Implicit discouragement of the publication's product
      // when "indicada" is asserted of a DIFFERENT product than the
      // publication offers.
      /\bla\s+resina\s+(indicada|correcta|adecuada|recomendada)\s+(es|sería)\b/i.test(text) ||
      // "el producto correcto / adecuado / indicado es X"
      /\b(?:el\s+producto|la\s+que\s+conviene)\s+(correct[oa]|indicad[oa]|adecuad[oa])\s+(es|sería)\b/i.test(text) ||
      // "lo que sí (tenemos|tienen|tenés) es X" — "what we DO have
      // is" framing always paired with redirect.
      /\blo\s+que\s+(sí|si)\s+(tenemos|tienen|tenés|tengo)\b/i.test(text) ||
      // "la que mejor aplica / sirve / funciona / encaja para" —
      // soft redirect to a different product variant.
      /\bla\s+que\s+(mejor|sí)\s+(aplica|sirve|funciona|encaja|conviene|va)\b/i.test(text);

    if (!discouragesProduct) return text;

    const storefront =
      process.env.MERCADOLIBRE_STORE_URL ||
      'https://www.mercadolibre.com.ar/tienda/servifibras';
    return `${text.trim()}\nMirá nuestras publicaciones acá: ${storefront}`;
  }

  /**
   * Marcos 2026-06-12 (3): sniff a likely first name out of the ML
   * apodo so the greeting reads "Hola Rocío," instead of "Hola
   * ROCIO.ELISA BARRIOS,". Returns null when the apodo doesn't look
   * like a person's name — the caller then drops the salutation
   * entirely.
   *
   * Heuristic:
   *   - Tokenise on `.` `_` `-` whitespace; take the first token.
   *   - Strip trailing digits ("JUAN89" → "JUAN").
   *   - Must be 2–15 letters (no digits / punctuation).
   *   - Must contain a vowel and not be more than ~75% consonants
   *     (rejects "BRRGZ"-style random handles).
   *   - Reject the ML auto-ID pattern (leading letter + long digit
   *     run, e.g. "J20250819233135").
   *
   * Examples (input → output):
   *   "ROCIO.ELISA BARRIOS"  → "Rocio"
   *   "rocio_2014"           → "Rocio"
   *   "JUAN89"               → "Juan"
   *   "J20250819233135"      → null
   *   "user-12345"           → null
   *   "@brrgz"               → null (consonant-heavy)
   *   "ARIANAYOSELIN"        → "Arianayoselin"
   */
  private extractLikelyFirstName(rawApodo: string): string | null {
    const v = (rawApodo ?? '').trim();
    if (!v) return null;
    // ML auto-ID: single letter prefix + 8+ digits.
    if (/^[A-Za-z]\d{6,}$/i.test(v)) return null;
    const tokens = v.split(/[._\-\s]+/).filter(Boolean);
    if (tokens.length === 0) return null;
    let first = tokens[0];
    // Strip trailing digits ("JUAN89" → "JUAN").
    first = first.replace(/\d+$/, '');
    // Strip accents for the validity check but keep original case to
    // titlecase later.
    const stripped = first.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (stripped.length < 2 || stripped.length > 15) return null;
    if (!/^[A-Za-zñÑ]+$/.test(stripped)) return null;
    const vowels = (stripped.match(/[aeiouAEIOU]/g) ?? []).length;
    if (vowels === 0) return null;
    if (vowels / stripped.length < 0.25) return null;
    // Reject generic ML auto-handles ("user-12345", "buyer-...",
    // "comprador-..."). These show up regularly enough that greeting
    // them by their literal prefix reads worse than skipping.
    const lc = stripped.toLowerCase();
    if (['user', 'usuario', 'usr', 'buyer', 'comprador', 'cliente', 'guest', 'visitante', 'invitado'].includes(lc)) {
      return null;
    }
    // Title case the surviving letters: "ROCIO" → "Rocio".
    return stripped[0].toUpperCase() + stripped.slice(1).toLowerCase();
  }

  private applyMlGreetingAndSignoff(
    text: string,
    turn?: import('../../use-cases/ai/ai.interface').AITurnContext,
  ): string {
    if (!text) return text;
    if (turn?.channel !== Channel.MERCADOLIBRE) return text;

    const rawName = (turn?.customerName ?? '').trim().replace(/^@+/, '');
    const safeName = rawName
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 60);

    // Marcos 2026-06-12 (3): less robotic greeting. ML usernames are
    // a mix of real first names ("ROCIO.ELISA BARRIOS"), human
    // handles ("rocio_2014"), and pure auto-IDs
    // ("J20250819233135"). The earlier rule used "Hola," whenever
    // the apodo wasn't a clean string, which read mechanical. Now we
    // sniff the apodo for a likely first name and greet by it; when
    // we can't find one, we drop the salutation entirely instead of
    // falling back to a generic "Hola,". The body then leads with
    // the actual answer.
    const likelyFirstName = this.extractLikelyFirstName(safeName);

    // Continuation mode — Marcos 2026-06-06: when this is NOT the
    // first AI reply to the buyer in this conversation, drop the
    // greeting and use a follow-up closer so the thread reads like a
    // human conversation instead of N independent "Hola X / Un saludo,
    // Lucas" blocks. The first reply still opens / signs off in full;
    // every subsequent reply skips the greeting and closes with
    // "Quedo a disposición."
    const isContinuation = turn?.isContinuation === true;
    const greeting = isContinuation
      ? null
      : likelyFirstName ? `Hola ${likelyFirstName},` : null;
    const signoff = isContinuation
      ? 'Quedo a disposición ante cualquier otra duda.'
      : 'Un saludo, Lucas de Servifibras.';

    let body = text.trim();
    // Drop an existing "Hola ..." opener so we don't double-greet — on
    // continuation this also removes the model-emitted re-greeting.
    body = body.replace(/^Hola[^\n,.!?]{0,80}[,.\n]\s*/i, '').trim();
    // Drop an existing "Un saludo, Lucas..." closer for the same reason.
    body = body.replace(/\n*Un\s+saludo,\s+Lucas\s+de\s+Servifibras\.?\s*$/i, '').trim();
    // Drop continuation-style trailing closers the model may have
    // already added so we don't double up either.
    body = body.replace(/\n*Quedo a disposici[oó]n[^\n]*\.?\s*$/i, '').trim();

    if (body.length === 0) {
      // No meaningful content (rare — empty after scrubs). Emit a
      // minimal placeholder so the buyer still gets a coherent message.
      const opener = greeting ?? '';
      const placeholder = isContinuation
        ? 'Si me pasás más detalle de la consulta, te respondo acá mismo.'
        : 'Gracias por escribirnos. Si me pasás más detalle de la consulta, te respondo acá mismo.';
      return [opener, placeholder, signoff].filter(Boolean).join('\n\n');
    }

    // ML safety net (Marcos 2026-06-03 PM): if the body discourages
    // the publication's product without including any
    // mercadolibre.com.ar link, append the storefront URL so the
    // buyer always has a path back to our catalog. Runs INSIDE the
    // wrapper so the appended line stays in the body paragraph and
    // doesn't trip the 3-bubble cap or duplicate the signoff.
    body = this.ensureMlAlternativeLink(body, Channel.MERCADOLIBRE);

    return [greeting, body, signoff].filter(Boolean).join('\n\n');
  }

  private enforceLengthBudget(text: string, channel?: Channel): string {
    if (!text) return text;
    const budget = Math.max(120, Number(process.env.REPLY_MAX_CHARS) || 450);
    const maxBubbles = Math.max(1, Number(process.env.REPLY_MAX_BUBBLES) || 3);

    const splitLongChunk = (chunk: string): string[] => {
      if (chunk.length <= budget) return [chunk];
      const out: string[] = [];
      // Try single-newline boundaries first.
      const lines = chunk.split('\n');
      let buf = '';
      for (const line of lines) {
        const candidate = buf ? `${buf}\n${line}` : line;
        if (candidate.length <= budget) {
          buf = candidate;
        } else {
          if (buf) out.push(buf);
          // Single line bigger than the budget — sentence-split.
          if (line.length <= budget) {
            buf = line;
          } else {
            const sentences = line.split(/(?<=[.!?])\s+/);
            let sbuf = '';
            for (const s of sentences) {
              const cand = sbuf ? `${sbuf} ${s}` : s;
              if (cand.length <= budget) sbuf = cand;
              else { if (sbuf) out.push(sbuf); sbuf = s.slice(0, budget); }
            }
            if (sbuf) out.push(sbuf);
            buf = '';
          }
        }
      }
      if (buf) out.push(buf);
      return out;
    };

    const blocks = text
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    const expanded: string[] = [];
    for (const b of blocks) expanded.push(...splitLongChunk(b));
    const capped = expanded.slice(0, maxBubbles);

    if (channel === Channel.MERCADOLIBRE) {
      // ML allows only ONE response per Q&A — but the customer still
      // needs the product info, not just the intro line. Join all the
      // bubbles back with single newlines (compact), then clamp to the
      // budget at the cleanest break we can find. Priority for the
      // cut: paragraph (\n\n) → newline (\n) → sentence end (. ? !) →
      // hard cut. Hard cut is last-resort and only if every higher
      // boundary lands too early (under 50% of the budget) — preserves
      // SKU/price info that Marcos cares about for the buyer's decision.
      const joined = capped.join('\n').trim();
      if (joined.length <= budget) return joined;
      const cut = joined.slice(0, budget);
      const breaks = [
        cut.lastIndexOf('\n\n'),
        cut.lastIndexOf('\n'),
        cut.lastIndexOf('. '),
        cut.lastIndexOf('? '),
        cut.lastIndexOf('! '),
      ].filter((i) => i > budget * 0.5);
      const at = breaks.length > 0 ? Math.max(...breaks) + 1 : budget;
      this.logger.warn(
        `ML reply clamped: ${joined.length} → ${at} chars (budget ${budget})`,
      );
      return joined.slice(0, at).trim();
    }

    return capped.join('\n\n');
  }

  async reloadKnowledgeBase(): Promise<void> {
    await this.loadKnowledgeBase();
  }

  private ensureConfigured(): void {
    if (!this.isConfigured || !this.client) {
      throw new Error(
        'Claude API not configured. Please add CLAUDE_API_KEY to .env file.',
      );
    }
  }

  /**
   * Env-driven max-tokens budgets. Each call site has its own ceiling so
   * Marcos can tune the customer-reply path independently from the
   * "redactar con IA" or healthcheck pings.
   */
  private maxTokens(envKey: string, fallback: number): number {
    const raw = process.env[envKey];
    const n = raw != null ? Number(raw) : fallback;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private getPricingTools(): Anthropic.Tool[] {
    return [
      {
        name: 'calculate_price',
        description:
          'Calcula el precio de un producto de Servifibras. Usa esta herramienta cuando el cliente pregunte por precios, cotizaciones o costos. Funciona con resinas, fibra de vidrio y siliconas. Retorna el precio en pesos argentinos (ARS) y dólares (USD) al tipo de cambio del día.',
        input_schema: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description:
                'Nombre del producto (ej: "Resina Epoxi 5kg", "Resina Poliéster 20 litros", "Fibra Mat 300")',
            },
            quantity: {
              type: 'number',
              description: 'Cantidad de unidades solicitadas (mínimo 1)',
            },
            customerType: {
              type: 'string',
              enum: ['minorista', 'mayorista', 'emprendedor', 'industrial'],
              description:
                'Tipo de cliente: minorista (retail), mayorista (wholesale), emprendedor (entrepreneur), industrial',
            },
            channel: {
              type: 'string',
              enum: ['whatsapp', 'facebook', 'instagram', 'mercadolibre'],
              description: 'Canal de venta (opcional, por defecto whatsapp)',
            },
          },
          required: ['productName', 'quantity', 'customerType'],
        },
      },
    ];
  }

  private async handleToolUse(
    toolName: string,
    toolInput: any,
  ): Promise<string> {
    if (toolName === 'calculate_price') {
      try {
        const { productName, quantity, customerType, channel } = toolInput;
        const quote = await this.pricingCalculator.calculatePriceByName(
          productName,
          quantity,
          customerType || 'minorista',
          channel || 'whatsapp',
        );

        // Return structured result for AI to format naturally
        return JSON.stringify({
          product: quote.product.name,
          quantity: quote.quantity,
          priceUSD: Math.round(quote.finalPriceUSD),
          priceARS: Math.round(quote.finalPriceARS),
          exchangeRate: quote.exchangeRate.rate,
          discounts: {
            volume: quote.volumeDiscount,
            customer: quote.channelDiscount,
          },
          formatted: quote.toFormattedString(),
        });
      } catch (error: any) {
        this.logger.error('Failed to calculate price', error);
        return JSON.stringify({
          error: error.message || 'No se pudo calcular el precio',
        });
      }
    }

    return JSON.stringify({ error: 'Unknown tool' });
  }

  async askQuestion(question: string): Promise<string> {
    this.ensureConfigured();
    const budget = await this.budget.ensureWithinBudget('ask');
    if (!budget.allowed) throw new BudgetExceededError(budget.reason!);

    try {
      this.logger.debug(`Sending question to Claude: ${question.substring(0, 50)}...`);

      // Build system prompt with knowledge base and pricing instructions
      let systemPrompt = '';
      if (this.knowledgeBaseContext) {
        systemPrompt = this.knowledgeBaseContext + '\n\n';
      }
      systemPrompt += `Eres un asistente de ventas técnico de Servifibras, empresa argentina de materiales compuestos.

IMPORTANTE sobre precios:
- Cuando el cliente pregunte por precios, usa la herramienta calculate_price
- Si no estás seguro del tipo de cliente, pregunta o asume "minorista" por defecto
- Los mayoristas compran grandes volúmenes (100L+, distribuyen, tienen empresa)
- Siempre responde en español con el cliente, profesional pero amigable
- Después de dar un precio, pregunta si necesita algo más o si quiere hacer el pedido`;

      // Build request with tools
      const messages: Anthropic.MessageParam[] = [
        {
          role: 'user',
          content: question,
        },
      ];

      let response = await this.client!.messages.create({
        model: this.model,
        max_tokens: this.maxTokens('CLAUDE_MAX_TOKENS_ASK', 2048),
        system: systemPrompt,
        messages,
        tools: this.getPricingTools(),
      });
      await this.budget.recordUsage('ask', this.model, response);

      this.logger.debug(`Response stop_reason: ${response.stop_reason}`);

      // Handle tool use
      if (response.stop_reason === 'tool_use') {
        // Find tool use block
        const toolUseBlock = response.content.find(
          (block) => block.type === 'tool_use',
        ) as Anthropic.ToolUseBlock | undefined;

        if (toolUseBlock) {
          this.logger.debug(
            `Tool used: ${toolUseBlock.name} with input: ${JSON.stringify(toolUseBlock.input)}`,
          );

          // Execute tool
          const toolResult = await this.handleToolUse(
            toolUseBlock.name,
            toolUseBlock.input,
          );

          this.logger.debug(`Tool result: ${toolResult}`);

          // Continue conversation with tool result
          messages.push({
            role: 'assistant',
            content: response.content,
          });

          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: toolResult,
              },
            ],
          });

          // Get final response
          response = await this.client!.messages.create({
            model: this.model,
            max_tokens: this.maxTokens('CLAUDE_MAX_TOKENS_ASK', 2048),
            system: systemPrompt,
            messages,
            tools: this.getPricingTools(),
          });
          await this.budget.recordUsage('ask', this.model, response);
        }
      }

      const answer = this.extractTextFromResponse(response);
      this.logger.debug(`Final answer: ${answer.substring(0, 100)}...`);

      return answer;
    } catch (error: any) {
      // Budget-exceeded errors propagate cleanly without an extra usage row.
      if (error instanceof BudgetExceededError) throw error;
      await this.budget.recordUsage('ask', this.model, null, true);
      this.logger.error('Failed to get response from Claude', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  /**
   * Compose the Anthropic request config + supporting metadata for a
   * reply turn. Extracted from `continueConversation` so the batch
   * path (Bloque E item 4) can build identical requests without
   * duplicating the prompt-assembly logic. Returns the bits the
   * caller needs to actually send the request and record usage.
   */
  async composeReplyRequest(
    conversation: AIConversation,
    newMessage: string,
    turn?: import('../../use-cases/ai/ai.interface').AITurnContext,
  ): Promise<{
    config: any;
    modelForTurn: string;
    messages: Anthropic.MessageParam[];
    usageOpts: { isTestTraffic: boolean };
  }> {
    // Convert domain AIConversation to Anthropic format. Typed as
    // `Anthropic.MessageParam[]` so the tool-use loop can push
    // structured content without TS complaints.
    const scrubForHistory =
      turn?.channel === Channel.MERCADOLIBRE
        ? (text: string) => this.dropFabricatedUrls(text, Channel.MERCADOLIBRE).text
        : (text: string) => text;
    const messages: Anthropic.MessageParam[] = [
      ...conversation.messages.map((msg) => ({
        role: msg.role,
        content: msg.role === 'assistant' ? scrubForHistory(msg.content) : msg.content,
      })),
      {
        role: 'user' as const,
        content: newMessage,
      },
    ];

    const styleBlock = await this.conversationStyle.buildSystemPromptBlock(
      undefined,
      turn?.channel,
    );
    const systemBlocks: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }> = [];
    if (this.lucasPrompt && this.lucasPrompt.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: this.lucasPrompt,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (this.knowledgeBaseContext && this.knowledgeBaseContext.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: this.knowledgeBaseContext,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (turn?.contactId) {
      try {
        const ctxBlock = await this.customerContext.buildBlock(turn.contactId);
        if (ctxBlock && ctxBlock.length > 0) {
          systemBlocks.push({
            type: 'text',
            text: ctxBlock,
            cache_control: { type: 'ephemeral' },
          });
        }
      } catch (err: any) {
        this.logger.warn(`customer-context block fetch failed (non-fatal): ${err.message}`);
      }
    }
    // Bloque E item 5 — Marcos 2026-06-06: compressed-history summary.
    // When the inbound handler trimmed the verbatim message tail and
    // handed over a Spanish summary block of the older portion, push
    // it here as a cached system block so subsequent turns on the
    // same conversation read from cache instead of re-uploading the
    // full message backlog. Placed after customer-context so the most-
    // recent/most-stable cache hierarchy is: Lucas > KB > customer >
    // history-summary > style/guardrails/listing.
    const compressedHistory = (turn as any)?.compressedHistorySummary;
    if (compressedHistory && typeof compressedHistory === 'string' && compressedHistory.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: compressedHistory,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (styleBlock && styleBlock.length > 0) {
      systemBlocks.push({ type: 'text', text: styleBlock });
    }
    const channelGuardrails = channelGuardrailBlock(turn?.channel);
    if (channelGuardrails) {
      systemBlocks.push({ type: 'text', text: channelGuardrails });
    }
    if (turn?.channel === Channel.MERCADOLIBRE) {
      const listingBlock = mlListingContextBlock((turn as any).mercadolibreListing);
      if (listingBlock) {
        systemBlocks.push({ type: 'text', text: listingBlock });
      }
    }
    // Marcos 2026-06-18: librería de respuestas rápidas. Si hay chips
    // con feedAi=true, inyectamos el bloque "FORMULACIONES APROBADAS"
    // ÚLTIMO — después del listing — para que cuando el comprador
    // pregunte algo que matchea una de estas etiquetas (ej. "tenés
    // stock?", "¿hacen envíos?") la IA copie la formulación curada
    // por el equipo en vez de inventar. Fire-and-forget: si la consulta
    // a Postgres falla por cualquier motivo, dejamos que la IA siga
    // sin este bloque — no es información crítica.
    if (this.quickReplies) {
      try {
        const approvedReplies = await this.quickReplies.listForAi();
        const block = approvedFormulationsBlock(approvedReplies);
        if (block) {
          systemBlocks.push({ type: 'text', text: block });
        }
      } catch (err: any) {
        this.logger.warn(`quick-replies AI block load failed (non-fatal): ${err.message}`);
      }
    }
    const tools = [this.getCatalogSearchTool(), this.getLaminadosCotizadorTool()];
    const modelForTurn = (turn?.modelOverride && turn.modelOverride.trim().length > 0)
      ? turn.modelOverride
      : this.model;
    const replyMaxTokensForLevel = (lvl?: 1 | 2 | 3): number => {
      // Marcos 2026-06-18: L1=150/L2=300 dejaban respuestas cortadas a
      // mitad de oración en ML (consultas con dimensiones + alternativa
      // a otra publicación pasan los 300 tokens fácil). Subo los pisos
      // por defecto; .env sigue siendo el override real
      // (CLAUDE_MAX_TOKENS_REPLY_L1 / _L2).
      if (lvl === 1) return this.maxTokens('CLAUDE_MAX_TOKENS_REPLY_L1', 600);
      if (lvl === 2) return this.maxTokens('CLAUDE_MAX_TOKENS_REPLY_L2', 900);
      return this.maxTokens('CLAUDE_MAX_TOKENS_REPLY', 1024);
    };
    const requestConfig: any = {
      model: modelForTurn,
      max_tokens: replyMaxTokensForLevel(turn?.level),
      messages,
      tools,
    };
    if (systemBlocks.length > 0) {
      requestConfig.system = systemBlocks;
    }
    const usageOpts = { isTestTraffic: turn?.isTestTraffic === true };
    return { config: requestConfig, modelForTurn, messages, usageOpts };
  }

  /**
   * Apply the canonical reply post-processing chain (URL guard,
   * markdown strip, emoji strip, stalling-phrase strip, dollar /
   * payment-method scrubbing, ML "por este medio" backstop, length
   * budget, ML greeting + signoff). Public so the batch-result
   * pipeline (Bloque E item 4) can run identical post-processing
   * on Claude's text output without going through the full sync
   * tool-loop in `continueConversation`.
   */
  applyReplyPostProcessing(
    rawText: string,
    turn?: import('../../use-cases/ai/ai.interface').AITurnContext,
  ): string {
    const guarded = this.dropFabricatedUrls(rawText, turn?.channel);
    const stripped = stripMarkdownForChat(guarded.text);
    const noEmoji = stripDecorativeEmoji(stripped);
    const safeText = noEmoji.emptied
      ? (turn?.channel === Channel.MERCADOLIBRE
          ? '¡Gracias a vos por consultarnos!'
          : 'Gracias a vos.')
      : noEmoji.text;
    const noNarration = this.stripMetaNarration(safeText);
    const noStall = this.stripStallingPhrases(noNarration, turn?.channel);
    const noDollar = this.stripDollarReferences(noStall);
    const noPayMethod = this.stripPaymentMethodMentions(noDollar, turn?.channel);
    const withPorEsteMedio = this.ensureMlPorEsteMedioLine(noPayMethod, turn?.channel);
    const budgeted = this.enforceLengthBudget(withPorEsteMedio, turn?.channel);
    return this.applyMlGreetingAndSignoff(budgeted, turn);
  }

  /**
   * Strip the meta-narration / planning leak Marcos called out 2026-06-15:
   * "estoy en la publicación de resina, voy a responder esto…". The
   * model occasionally prefixes its reply with a paraphrase of the
   * system-prompt instructions ("Lucas (BIEN):", "voy a contestar",
   * "le voy a responder que…") instead of just answering. The system
   * prompt's example pairs ("Lucas BIEN: …", "Lucas MAL: …") are the
   * most likely source. This pass deletes those openers before the
   * buyer ever sees them — runs on every channel because narration
   * leakage is bad everywhere, not just ML.
   */
  private stripMetaNarration(text: string): string {
    if (!text) return text;
    // Each opener regex eats from the start of the string up to the
    // next comma OR sentence terminator — that way a compound prefix
    // like "Estoy en la publicación de X, voy a responder…, foo" can
    // be peeled clause-by-clause without taking the whole sentence
    // down with the first match.
    const NARRATION_RES: Array<{ name: string; re: RegExp }> = [
      // "Lucas (BIEN):" / "Lucas (MAL):" / leading "Lucas:" — the
      // example-formatting prefix from the system prompt leaking into
      // the actual output. Always remove (case-insensitive).
      { name: 'Lucas-prefix', re: /^\s*Lucas\s*(?:\([A-Za-zÁÉÍÓÚÑ]+\))?\s*[:：][\s"'«]*/i },
      // Self-orientation openers — the model verbalising its planning
      // step before answering.
      { name: 'estoy en la publicación', re: /^\s*(?:Bueno,?\s*)?[Ee]stoy en (?:la|esta) publicación[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'estoy mirando la publicación', re: /^\s*(?:Bueno,?\s*)?[Ee]stoy mirando (?:la|esta) publicación[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'veo que el cliente', re: /^\s*(?:Bueno,?\s*)?[Vv]eo que (?:el|este|la) (?:cliente|comprador|usuario)[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'voy a responder', re: /^\s*(?:Bueno,?\s*)?[Vv]oy a (?:responder|contestar|decirle|explicarle)[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'le voy a responder', re: /^\s*(?:Bueno,?\s*)?[Ll]e voy a (?:responder|contestar|decir|explicar)[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'mi respuesta sería', re: /^\s*(?:Bueno,?\s*)?[Mm]i respuesta (?:sería|va a ser|debería ser)[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'respondería:', re: /^\s*[Rr]espondería\s*[:：]\s*/g },
      { name: 'respondo:', re: /^\s*[Rr]espondo\s*[:：]\s*/g },
      { name: 'veamos qué responder', re: /^\s*(?:Bueno,?\s*)?[Vv]eamos (?:qué|que) (?:responder|contestar|le digo)[^,.!?\n]*[,.!?\n]+\s*/g },
      // Mid-text "como Lucas, le respondo…" stragglers (rare, but
      // possible after a tool call when the model reorients itself).
      { name: 'como Lucas', re: /\bComo Lucas[^,.!?\n]*[,]\s*/g },
    ];
    let cleaned = text;
    let hit = false;
    // Run the chain to fixed-point so compound openers get peeled
    // clause-by-clause: "Estoy en la publicación de X, voy a responder…"
    // first match eats "Estoy en la publicación de X,", then the next
    // pass catches "voy a responder…" at the new string head.
    for (let pass = 0; pass < 5; pass++) {
      let passHit = false;
      for (const r of NARRATION_RES) {
        if (r.re.test(cleaned)) {
          passHit = true;
          hit = true;
          cleaned = cleaned.replace(r.re, '');
          this.logger.warn(`Meta-narration scrubbed: ${r.name}`);
        }
      }
      if (!passHit) break;
    }
    if (!hit) return text;
    cleaned = cleaned.replace(/^[\s,;:]+/, '').replace(/\s{2,}/g, ' ');
    // If the whole reply was just narration, the buyer would get an
    // empty bubble — keep the original in that case; `enforceLengthBudget`
    // upstream + the channel-aware emptied fallback handle the worst case.
    if (cleaned.length === 0) return text;
    // Recapitalise the new opening word so we don't ship a reply that
    // starts mid-sentence: "voy a responder que sí, soporta hasta 800"
    // → after stripping → "soporta hasta 800" → "Soporta hasta 800".
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  /**
   * Bloque E item 4 — Marcos 2026-06-06: submit a batch of reply
   * turns to Anthropic's Message Batches API. Each entry composes
   * the same request a sync call would, then we pack them into a
   * single `messages.batches.create` POST. Anthropic discounts batch
   * input + output by 50%; latency budget for ML pre-venta is the
   * trade — buyers wait minutes longer for the same answer. Returns
   * the batch id so the queue service can poll for completion.
   */
  async submitReplyBatch(
    entries: Array<{
      customId: string;
      conversation: AIConversation;
      newMessage: string;
      turn?: import('../../use-cases/ai/ai.interface').AITurnContext;
    }>,
  ): Promise<{ batchId: string; submittedCount: number }> {
    this.ensureConfigured();
    if (entries.length === 0) {
      throw new Error('submitReplyBatch called with empty entries');
    }
    const requests: Array<{ custom_id: string; params: any }> = [];
    for (const e of entries) {
      const { config } = await this.composeReplyRequest(
        e.conversation,
        e.newMessage,
        e.turn,
      );
      const params: any = {
        model: config.model,
        max_tokens: config.max_tokens,
        messages: config.messages,
      };
      if (config.system) params.system = config.system;
      if (config.tools) params.tools = config.tools;
      requests.push({ custom_id: e.customId, params });
    }
    const batch = await this.client!.messages.batches.create({ requests } as any);
    this.logger.log(
      `📦 Submitted Anthropic batch ${batch.id} with ${requests.length} requests`,
    );
    return { batchId: batch.id, submittedCount: requests.length };
  }

  /**
   * Read current processing status of a previously-submitted batch.
   * `in_progress` → keep polling. `ended` → drain results. The SDK
   * also reports a `canceling` transient state we treat as in_progress.
   */
  async retrieveBatchStatus(
    batchId: string,
  ): Promise<{ status: 'in_progress' | 'canceling' | 'ended'; counts: any }> {
    this.ensureConfigured();
    const b: any = await this.client!.messages.batches.retrieve(batchId);
    return { status: b.processing_status, counts: b.request_counts };
  }

  /**
   * Stream the batch results. Each item maps back to one of the
   * `custom_id`s we submitted. For text replies we run the raw
   * `extractTextFromResponse` here so the caller can immediately
   * post-process; for tool_use stops we hand the raw message back
   * so the caller can run the sync fallback path; for error /
   * canceled / expired entries we surface a normalised error string.
   *
   * NOTE: usage from batch results is reported at the per-request
   * level inside the SDK response; the caller should record it via
   * `budget.recordUsage('reply', ...)` for accurate per-callsite
   * accounting (sync vs batch). The model id used is the same we
   * sent in `submitReplyBatch`.
   */
  async fetchBatchResults(batchId: string): Promise<
    Array<{
      customId: string;
      kind: 'text' | 'tool_use' | 'error';
      text?: string;
      errorMessage?: string;
      rawMessage?: any;
    }>
  > {
    this.ensureConfigured();
    const out: Array<any> = [];
    const decoder: any = await this.client!.messages.batches.results(batchId);
    for await (const item of decoder) {
      const customId: string = item.custom_id;
      const r = item.result;
      if (r?.type === 'succeeded') {
        const msg = r.message;
        if (msg.stop_reason === 'tool_use') {
          out.push({ customId, kind: 'tool_use', rawMessage: msg });
        } else {
          const text = this.extractTextFromResponse(msg);
          out.push({ customId, kind: 'text', text, rawMessage: msg });
        }
      } else if (r?.type === 'errored') {
        out.push({
          customId,
          kind: 'error',
          errorMessage: r.error?.error?.message || JSON.stringify(r.error || {}),
        });
      } else if (r?.type === 'canceled' || r?.type === 'expired') {
        out.push({ customId, kind: 'error', errorMessage: `batch entry ${r.type}` });
      } else {
        out.push({ customId, kind: 'error', errorMessage: 'unknown batch result type' });
      }
    }
    return out;
  }

  /**
   * Best-effort usage accounting for a batch reply. Wraps
   * `ClaudeBudgetService.recordUsage` so the queue service can call
   * it without having to know about the budget service shape.
   */
  async recordReplyUsage(
    model: string,
    response: any,
    opts?: { isTestTraffic?: boolean; errored?: boolean },
  ): Promise<void> {
    await this.budget.recordUsage('reply', model, response, {
      isTestTraffic: opts?.isTestTraffic === true,
      errored: opts?.errored === true,
    });
  }

  async continueConversation(
    conversation: AIConversation,
    newMessage: string,
    turn?: import('../../use-cases/ai/ai.interface').AITurnContext,
  ): Promise<string> {
    this.ensureConfigured();
    const budget = await this.budget.ensureWithinBudget('reply');
    if (!budget.allowed) throw new BudgetExceededError(budget.reason!);

    try {
      // Request assembly (system blocks, history scrub, tools,
      // per-level token caps) lives in `composeReplyRequest` so the
      // batch path (Bloque E item 4) can reuse the same prompt
      // building without duplicating Lucas/KB/customer-context/
      // listing-block logic. The original inline comments documenting
      // each block live there.
      const composed = await this.composeReplyRequest(conversation, newMessage, turn);
      const requestConfig: any = composed.config;
      const messages = composed.messages;
      const modelForTurn = composed.modelForTurn;
      const usageOpts = composed.usageOpts;
      this.logger.debug(
        `Continuing conversation with ${messages.length} messages`,
      );
      if (modelForTurn !== this.model) {
        this.logger.log(`🪙 Reply model override: ${modelForTurn} (L${turn?.level ?? '?'})`);
      }

      // Tool-use loop. Claude either replies with text directly or with
      // a `tool_use` block requesting a catalog search; we run the
      // search, post the result back as a `tool_result`, and ask Claude
      // again. Cap iterations so a misbehaving turn can't spin forever.
      const maxIterations = Number(process.env.CLAUDE_TOOL_LOOP_MAX) || 4;
      let response = await this.client!.messages.create(requestConfig);
      await this.budget.recordUsage('reply', modelForTurn, response, usageOpts);
      let iteration = 0;
      while (response.stop_reason === 'tool_use' && iteration < maxIterations) {
        iteration++;
        const toolUseBlocks = response.content.filter(
          (block: any) => block.type === 'tool_use',
        ) as Array<{ id: string; name: string; input: any }>;
        if (toolUseBlocks.length === 0) break;

        const toolResults: any[] = [];
        for (const tu of toolUseBlocks) {
          let resultText: string;
          if (tu.name === 'buscar_producto') {
            const q = String(tu.input?.consulta ?? tu.input?.query ?? '');
            const cap = Number(tu.input?.max_resultados) || 20;
            try {
              resultText = await this.productCatalog.searchForAI(q, cap);
              if (!resultText) resultText = '(sin resultados)';
              this.logger.debug(
                `Catalog search tool: q="${q}" → ${resultText.split('\n').length - 1} lines`,
              );
            } catch (err: any) {
              resultText = `Error en búsqueda: ${err?.message ?? 'desconocido'}`;
              this.logger.error(`Catalog search tool failed: ${err?.message ?? err}`);
            }
          } else if (tu.name === 'cotizar_laminado') {
            try {
              const result = await this.laminadosCotizador.cotizar({
                ancho: Number(tu.input?.ancho),
                espesor: String(tu.input?.espesor ?? ''),
                metrosLineales: Number(tu.input?.metros_lineales ?? tu.input?.metrosLineales),
                modoPago: (tu.input?.modo_pago ?? tu.input?.modoPago) === 'contado'
                  ? 'contado'
                  : 'transferencia',
              });
              // Marcos 2026-06-04: the Excel's prices are designed for
              // OFF-PLATFORM quotes (where Servifibras pockets the
              // margin). On MercadoLibre the platform takes a
              // commission (~20%), so we mark up the cotizator result
              // here so the customer sees the ML-adjusted price. The
              // markup factor is env-tunable (LAMINADOS_ML_SURCHARGE,
              // default 1.20). Pegamento + USD figures are left raw
              // because they're internal-only (USD never surfaces in
              // the reply post-2026-06-04 anyway).
              if (turn?.channel === Channel.MERCADOLIBRE && result.ok && result.ars) {
                const factor = Number(process.env.LAMINADOS_ML_SURCHARGE) || 1.20;
                result.ars = {
                  subtotal: +(result.ars.subtotal * factor).toFixed(2),
                  iva: result.ars.iva, // always 0 post-2026-06-04
                  total: +(result.ars.total * factor).toFixed(2),
                };
              }
              // Strip internal-only fields from the agent's tool
              // result so Claude can't accidentally leak them in the
              // reply (USD raw figures, exchange rate, USD/m² rate).
              // 2026-06-04 PM: agent kept dropping "(1450)" and "TC
              // de referencia" remnants by reading these fields.
              const safeResult: any = { ...result };
              delete safeResult.usd;
              delete safeResult.cotizacion;
              if (safeResult.product) {
                const { usdPorMetroLineal, ...productRest } = safeResult.product;
                safeResult.product = productRest;
              }
              resultText = JSON.stringify(safeResult, null, 2);
              this.logger.debug(
                `Laminados cotizador tool: ancho=${tu.input?.ancho} espesor=${tu.input?.espesor} metros=${tu.input?.metros_lineales} channel=${turn?.channel ?? 'unknown'} → ok=${result.ok}`,
              );
            } catch (err: any) {
              resultText = JSON.stringify({ ok: false, reason: 'cotizador_error', message: err?.message ?? 'desconocido' });
              this.logger.error(`Laminados cotizador tool failed: ${err?.message ?? err}`);
            }
          } else {
            resultText = `Herramienta desconocida: ${tu.name}`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: resultText,
          });
        }
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        requestConfig.messages = messages;
        // After a tool call, the next pass has to weave the catalog /
        // cotizator JSON into prose — 150 tokens is too tight for that
        // synthesis step. Lift the cap to the default ceiling for this
        // and every subsequent iteration of the loop.
        requestConfig.max_tokens = this.maxTokens('CLAUDE_MAX_TOKENS_REPLY', 1024);
        response = await this.client!.messages.create(requestConfig);
        await this.budget.recordUsage('reply', modelForTurn, response, usageOpts);
      }

      // Post-processing chain (URL guard, markdown/emoji strip,
      // stalling-phrase scrub, dollar/payment-method scrub, ML "por
      // este medio" backstop, length budget, ML greeting+signoff)
      // lives in `applyReplyPostProcessing` so the batch path can
      // run identical processing on Claude's batch output.
      const raw = this.extractTextFromResponse(response);
      return this.applyReplyPostProcessing(raw, turn);
    } catch (error: any) {
      if (error instanceof BudgetExceededError) throw error;
      const errModel = (turn?.modelOverride && turn.modelOverride.trim().length > 0)
        ? turn.modelOverride
        : this.model;
      await this.budget.recordUsage('reply', errModel, null, {
        errored: true,
        isTestTraffic: turn?.isTestTraffic === true,
      });
      this.logger.error('Failed to continue conversation', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  /**
   * Catalog-search tool exposed to the customer-reply path. Replaces
   * the "dump every product into the system prompt" approach. The
   * agent calls this when a customer asks about products / prices /
   * stock; we run a scored ILIKE search over name/category/description
   * and return the top N rows.
   *
   * Schema mirrors the JSON-tool format Anthropic's API expects.
   * Spanish parameter names so Lucas's Spanish-language prompt
   * references them naturally.
   */
  private getCatalogSearchTool(): any {
    return {
      name: 'buscar_producto',
      description:
        'Busca productos en el catálogo de TiendaNube en tiempo real. Llamala cada vez que el cliente pregunte por productos, presentaciones, precios, stock, o links. Devuelve los productos que mejor coinciden con la consulta, con SKU, nombre, presentación, precio en ARS, stock y link. NO inventes precios ni SKUs — usá únicamente los que devuelve esta herramienta.',
      input_schema: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description:
              'Palabras clave del producto que busca el cliente. Pueden ser nombres ("resina epoxi cristal"), categorías ("siliconas"), usos ("para mesa", "para bijouterie") o SKU exacto.',
          },
          max_resultados: {
            type: 'number',
            description:
              'Cantidad máxima de productos a devolver. Default 20. Subilo a 30-40 cuando el cliente pide "todas las opciones" de un tipo.',
          },
        },
        required: ['consulta'],
      },
    };
  }

  /**
   * Laminados PRFV cotizador. Replaces the "silence + escalate to
   * human" rule on laminates (Marcos 2026-06-03 pivot). The agent
   * calls this whenever a buyer asks for a budget on a laminate
   * product with width × thickness × meters. The tool returns the
   * structured quote (USD subtotal, tier discount applied, ARS
   * conversion at the live blue-dollar rate, IVA breakdown, and a
   * pegamento recommendation). The agent's job is to phrase the
   * answer; the numbers come from the table verbatim.
   */
  private getLaminadosCotizadorTool(): any {
    return {
      name: 'cotizar_laminado',
      description:
        'Cotiza un laminado PRFV (PoliÉster Reforzado con Fibra de Vidrio) con precio actualizado por metro lineal en USD, convertido a ARS según la cotización blue del día, con descuento por volumen aplicado (10/15/20% por tramo) y recomendación de pegamento. Llamala SIEMPRE que un comprador pida un presupuesto/cotización de lámina/plancha/PRFV con ancho y espesor específicos. Devuelve un objeto JSON con producto, subtotal USD, descuento aplicado, total ARS y pegamento sugerido — copiá los números literales en la respuesta, NO los recalcules vos.',
      input_schema: {
        type: 'object',
        properties: {
          ancho: {
            type: 'number',
            description:
              'Ancho de la lámina en metros (ej: 2.6, 2.2, 1.1). Anchos disponibles: 1.1, 1.22, 2.0, 2.1, 2.2, 2.4, 2.5, 2.6.',
          },
          espesor: {
            type: 'string',
            description:
              'Espesor de la lámina (ej: "2mm", "1.5mm", "1.6mm"). Espesores disponibles: 1.5mm (liso), 1.6mm, 2mm (reforzado).',
          },
          metros_lineales: {
            type: 'number',
            description:
              'Metros lineales que el comprador quiere. Si menciona m² calculá: m² / ancho = metros lineales.',
          },
          modo_pago: {
            type: 'string',
            enum: ['transferencia', 'contado'],
            description:
              'Forma de pago. "transferencia" agrega IVA 21% al subtotal. "contado" es sin IVA. Default: transferencia.',
          },
        },
        required: ['ancho', 'espesor', 'metros_lineales'],
      },
    };
  }

  /**
   * "Redactar con IA" — Marcos's brief asks for a sparkle button next to
   * the composer that improves whatever the operator typed (or proposes a
   * full reply if the draft is empty). We feed Claude the operator draft
   * plus the recent conversation history so it can match tone and stay
   * on-topic.
   *
   * Returns null if Claude isn't configured — the caller surfaces a friendly
   * "conectá la API key" toast instead of a hard error.
   *
   * `mode = 'improve'` rewrites the draft into a polished operator reply.
   * `mode = 'suggest'` (when the draft is empty) drafts one from scratch
   * based on the conversation context.
   */
  async redactDraft(args: {
    history: AIConversation;
    draft: string;
    mode?: 'improve' | 'suggest';
  }): Promise<string | null> {
    if (!this.isConfigured || !this.client) {
      // Soft no-op so the UI button stays usable in dev (just toasts the
      // user) — same pattern as `OrderStatusReplyService` returning null.
      return null;
    }

    const mode = args.mode ?? (args.draft.trim().length === 0 ? 'suggest' : 'improve');

    // System prompt is ESCRITURA-specific (not the customer-facing AI
    // persona) — we want a concise, professional Spanish reply tailored
    // to a B2B composite-materials shop.
    const system =
      'Sos asistente de redacción para operadores de Servifibras. ' +
      'Generás respuestas breves, claras y profesionales en español rioplatense. ' +
      'Devolvé únicamente el mensaje listo para enviar al cliente — sin saludos formales innecesarios, sin firma, sin comentarios sobre el cambio. ' +
      'No inventes precios, números de pedido ni datos que no estén en el historial.';

    const transcript = args.history.messages
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'Cliente' : 'Operador'}: ${m.content}`)
      .join('\n');

    const userPrompt = mode === 'improve'
      ? `Contexto de la conversación reciente:\n${transcript}\n\nBorrador del operador:\n"${args.draft}"\n\nMejorá la redacción manteniendo el sentido. Devolvé solo el texto mejorado.`
      : `Contexto de la conversación reciente:\n${transcript}\n\nProponé una respuesta breve para enviarle al cliente. Devolvé solo el texto.`;

    const budget = await this.budget.ensureWithinBudget('redact');
    if (!budget.allowed) throw new BudgetExceededError(budget.reason!);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens('CLAUDE_MAX_TOKENS_REDACT', 500),
        system,
        messages: [{ role: 'user', content: userPrompt }],
      });
      await this.budget.recordUsage('redact', this.model, response);
      const text = this.extractTextFromResponse(response).trim();
      // Strip surrounding quotes if Claude wrapped the answer.
      return text.replace(/^["“'']/, '').replace(/["”'']$/, '');
    } catch (err: any) {
      if (err instanceof BudgetExceededError) throw err;
      await this.budget.recordUsage('redact', this.model, null, true);
      this.logger.error(`redactDraft failed: ${err.message}`);
      throw err;
    }
  }

  isAvailable(): boolean {
    return this.isConfigured && this.client !== null;
  }

  /**
   * Single-shot prompt that expects a JSON response. Used by the LLM-backed
   * classifiers (complexity, customer-type, etc) — keeps prompt construction
   * uniform and parses Claude's `text` block back into an object. Returns
   * `null` when Claude isn't configured or the response can't be parsed —
   * callers fall back to their keyword heuristics in that case.
   */
  async askJson(args: {
    system: string;
    user: string;
    maxTokens?: number;
    /** Optional sub-callsite id ("complexity", "customer_type", etc) so
     *  the budget tracker can break spend down per detector. Falls back
     *  to "json" when not provided. */
    callSite?: string;
    /** Optional model override. Lets the quality scorer + other
     *  detectors route to a cheaper Haiku-class model without changing
     *  the customer-reply default. Marcos 2026-06-03: quality scoring
     *  was burning ~3× the cost of customer replies because it ran on
     *  the same Sonnet model — Haiku gives comparable JSON evaluation
     *  at a fraction of the input/output token price. */
    model?: string;
    /** Whether this call originated from a sandbox/test conversation.
     *  Stamped on the usage event so the dashboard can split
     *  real-customer spend from dev/test spend. */
    isTestTraffic?: boolean;
  }): Promise<any | null> {
    if (!this.isConfigured || !this.client) return null;
    const callSite = `json:${args.callSite ?? 'unknown'}`;
    const budget = await this.budget.ensureWithinBudget(callSite);
    if (!budget.allowed) {
      // For askJson the contract is "return null on failure" — same goes
      // for budget exhaustion. Each LLM detector already falls back to
      // its keyword path on null, which is the right behaviour.
      this.logger.warn(`askJson(${callSite}) skipped: ${budget.reason}`);
      return null;
    }
    const modelToUse = (args.model && args.model.trim().length > 0) ? args.model : this.model;
    try {
      const response = await this.client.messages.create({
        model: modelToUse,
        max_tokens: args.maxTokens ?? this.maxTokens('CLAUDE_MAX_TOKENS_JSON', 256),
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      });
      await this.budget.recordUsage(callSite, modelToUse, response, {
        isTestTraffic: args.isTestTraffic === true,
      });
      const text = this.extractTextFromResponse(response).trim();
      if (!text) return null;
      // Claude sometimes wraps JSON in ```json fences; strip them.
      const stripped = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      try {
        return JSON.parse(stripped);
      } catch {
        // Try to find the first {...} block as a last resort.
        const m = stripped.match(/\{[\s\S]*\}/);
        if (m) {
          try { return JSON.parse(m[0]); } catch { /* fall through */ }
        }
        this.logger.warn(`askJson: could not parse Claude response as JSON: ${stripped.slice(0, 100)}`);
        return null;
      }
    } catch (err: any) {
      await this.budget.recordUsage(callSite, modelToUse, null, {
        errored: true,
        isTestTraffic: args.isTestTraffic === true,
      });
      this.logger.error(`askJson failed: ${err.message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured || !this.client) {
      this.logger.warn('Health check failed: API not configured');
      return false;
    }

    try {
      // Simple ping to verify API key works. Health is intentionally NOT
      // gated by the budget — we always want to know whether the API is
      // reachable, even when over budget — but spend is still recorded.
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      await this.budget.recordUsage('health', this.model, response);
      return true;
    } catch (error) {
      await this.budget.recordUsage('health', this.model, null, true);
      this.logger.error('Health check failed', error);
      return false;
    }
  }

  private extractTextFromResponse(response: Anthropic.Message): string {
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }
    return textContent.text;
  }
}
