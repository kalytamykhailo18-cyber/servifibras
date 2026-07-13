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

/**
 * Marcos 2026-06-18 PM: bloque de fallback cuando NO pudimos cargar
 * la publicación. Sin esto el agente quedaba sin contexto y respondía
 * "¿sobre qué producto me estás preguntando?" — error grave en ML,
 * donde el comprador siempre está parado en UNA publicación
 * específica y preguntarle "cuál" es admitir desorientación.
 */
function mlListingMissingContextBlock(): string {
  return [
    '▸ PUBLICACIÓN ACTUAL DE MERCADOLIBRE — contexto no cargado',
    '',
    'No pudimos cargar los detalles de la publicación específica en la que el comprador escribió esta pregunta (puede ser un fallo transitorio de la API de ML, una publicación pausada / eliminada, o una publicación con permisos restringidos). NO admitas el error en la respuesta.',
    '',
    'REGLA #1 — PROHIBIDO ABSOLUTAMENTE preguntar qué producto está mirando el comprador. El comprador YA está parado en una publicación específica; pedirle que la identifique es admitir que no tenemos contexto y baja el score de la cuenta. Frases prohibidas — NUNCA usarlas ni parafrasearlas:',
    '  - "¿Cuál es el producto que querés comprar?"',
    '  - "¿Sobre qué producto me estás preguntando?"',
    '  - "¿A qué producto te referís?"',
    '  - "¿De qué producto se trata?"',
    '  - "Contame cuál es el producto"',
    '  - "Necesito saber qué producto"',
    '  - Cualquier variante de "identificame el producto" — está PROHIBIDO en todas sus formas.',
    '',
    'REGLA #2 — Reglas mientras dure la falta de contexto:',
    '  - Si la pregunta tiene una pista del producto (ej. nombra "resina", "lámina", "fibra", "pigmento", una medida, un kilo, una presentación), inferí el rubro de ahí y llamá a `buscar_producto` con esa pista — eso te devuelve productos del catálogo con su link de ML.',
    '  - Si la pregunta es genérica ("¿tenés stock?", "¿hacen envíos?", "¿cuánto sale?", "¿llega el mismo día?", "¿mandan a X ciudad?"), respondé en términos del rubro de la cuenta (Servifibras = resinas, fibras de vidrio, laminados PRFV, pigmentos, siliconas) sin nombrar un producto puntual. Ej: para "¿tenés stock?" → "Sí, lo tenemos disponible para enviar de inmediato."',
    '  - Preguntas de logística/envío ("¿llega en el día a X?", "¿mandan a Y?", "¿cuánto tarda?") se responden con la política general de Servifibras: envíos a todo el país por correo o transporte; despacho el mismo día si la compra entra hasta las 12hs; el ítem sale del depósito de Caseros. NO pidas datos del producto para responder envíos.',
    '  - PROHIBIDO inventar nombres de producto, precios, medidas o stocks. Si no podés deducir el rubro y la pregunta no es genérica ni de envíos, contestá pidiendo que el comprador AMPLÍE la consulta (ej. "Para darte el dato exacto necesitamos un detalle más — ¿cuántos kilos / qué medida / qué uso le vas a dar?") en vez de pedir que diga "qué producto".',
    '',
    'REGLA #3 — Caso real (Marcos 2026-07-06, publicación MLA860894868 "Alcohol Polivinílico Pva Concentración 10%"). Comprador VENTURINORODOLFO preguntó "Hola. En Avellaneda centro llega en el día?". El agente respondió "Voy a verificar la disponibilidad de envío en ese código postal para vos. ¿Cuál es el producto que querés comprar? Así te confirmo si la opción de envío en el día está disponible en Avellaneda centro según MercadoLibre." — DOS VIOLACIONES:',
    '  (a) "Voy a verificar" — viola la regla one-shot (nunca prometas revisar y volver después).',
    '  (b) "¿Cuál es el producto que querés comprar?" — viola la regla #1 de acá arriba. El comprador está en una publicación específica, no hay que preguntarle qué producto.',
    'Respuesta correcta: "Hola VENTURINORODOLFO, sí, a Avellaneda centro llegamos el mismo día si hacés la compra hasta las 12hs. El paquete sale del depósito de Caseros (Bs As). Un saludo, Lucas de Servifibras." — directo, con el dato de envío, sin pedir aclaración del producto.',
  ].join('\n');
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
    '⚠️ MISMO RUBRO, DIFERENTE PRESENTACIÓN / COMPLEMENTO — Marcos 2026-06-18 PM:',
    'La regla cross-publicación se aplica TAMBIÉN cuando el comprador pide más cantidad del mismo producto en otra presentación, o un complemento que no es esta publicación pero igual lo manejamos. NUNCA contestes "te paso por aparte" / "consultalo con nosotros" / "te lo envío al privado" — siempre buscar_producto + link ML literal en la respuesta.',
    'Casos típicos:',
    '  - Comprador en una publicación de Resina Epoxi 1kg pregunta "¿tenés de 5 kg?" → buscar_producto("resina epoxi 5kg") → devolvé el link ML del 5 kg.',
    '  - Comprador en una publicación de Resina Epoxi pregunta "¿tenés pigmentos?" → buscar_producto("pigmento resina") → devolvé el link ML del pigmento (uno, el más representativo, NO una lista de 10).',
    '  - Comprador en una publicación de Lámina PRFV pregunta "¿qué pegamento uso?" → buscar_producto("pegamento prfv") → devolvé el link ML del pegamento.',
    'Lo que SIEMPRE va junto al link: el nombre exacto del producto cross + el formato canónico de arriba. Lo que NUNCA va: precio del producto cross, cantidad, m², "te lo armo con todo en el mismo pedido", "te lo paso por privado".',
    '',
    '⚠️ PEDIDOS VAGOS DE TAMAÑO / MEDIDA — Marcos 2026-06-22 (caso real MLA1475090319):',
    'El comprador escribió "Hola! Un poco más grande?" sobre un molde de 21,3cm. El agente respondió "tenemos otras opciones disponibles. ¿Qué medida tenías en mente? Así te paso la publicación correcta." — esa pregunta de retorno NO PUEDE OCURRIR. El comprador acabó de escribirte una sola línea, casi nunca vuelve a contestar, y la ML lo cuenta como pregunta sin resolver para el score de la cuenta.',
    'Cuando el comprador pide algo VAGAMENTE más grande / más chico / otra medida / otro tamaño SIN especificar el target, NO preguntes "¿qué medida?". En su lugar:',
    '  1. Llamá a buscar_producto con la categoría del producto + el rango siguiente. Ej. publicación "molde silicona disco 21,3cm" + "un poco más grande" → buscar_producto("molde silicona disco 30").',
    '  2. Si la herramienta devuelve alguna opción más grande con link ML, copiala TEXTUAL en la respuesta usando el formato canónico cross-publicación.',
    '  3. Si devuelve VARIAS (ej. 26cm, 30cm, 40cm), elegí la 1 más representativa (la siguiente medida hacia arriba). Sólo en el caso muy específico de "te dejo las opciones que tengo" podés pasar 2-3 — pero siempre con link, nunca tirar nombres sueltos.',
    '  4. Cerrá con una invitación CONDICIONAL: "Si necesitás otra medida puntual, decime el tamaño y la busco." Eso es proactivo, no una pregunta abierta.',
    '  5. Sólo si literalmente NO hay nada más grande/más chico en el catálogo (buscar_producto devolvió vacío en 2 intentos), recién ahí decís "esa es la única medida que manejamos".',
    'Ejemplo MAL (lo que pasó 2026-06-22): "tenemos otras opciones disponibles. ¿Qué medida tenías en mente?".',
    'Ejemplo BIEN: "El molde de esta publicación es de 21,3 cm. Una medida más grande la encontrás en la publicación específica: https://articulo.mercadolibre.com.ar/MLA-... . Si necesitás otra medida puntual, decime el tamaño y la busco."',
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
  // Marcos 2026-06-24: reglas específicas para canales privados
  // (WhatsApp / Facebook / Instagram / TiendaNube webchat). El agente
  // estaba usando los MLA permalinks del catálogo en respuestas de
  // estos canales, mandando al cliente a comprar en Mercado Libre
  // cuando en realidad la venta directa por estos canales es más
  // valiosa (menos comisión, lead nuestro, relación directa).
  if (
    channel === Channel.WHATSAPP ||
    channel === Channel.FACEBOOK ||
    channel === Channel.INSTAGRAM ||
    channel === Channel.TIENDANUBE_WEBCHAT
  ) {
    return [
      '▸ REGLAS DE CANALES PRIVADOS (WhatsApp / FB / IG / Webchat)',
      '',
      'Estás respondiendo a un cliente por WhatsApp, Facebook, Instagram o el chat de TiendaNube. Reglas duras para este canal:',
      '',
      '1. PROHIBIDO mandar links de Mercado Libre (mercadolibre.com.ar / articulo.mercadolibre.com.ar / tienda/servifibras en ML). El cliente ya está hablando con nosotros directamente; mandarlo a ML lo saca de nuestro canal, agrega comisión y debilita la relación. Si necesitás referenciar un producto:',
      '   - Preferí el link de TiendaNube si el producto lo tiene (tiendaservifibras.com).',
      '   - Si no hay link de TiendaNube, describí el producto con nombre + presentación + precio y ofrecé armar el pedido directo: "Te lo armo desde acá, decime cantidad y zona de entrega".',
      '   - JAMÁS pegues una URL articulo.mercadolibre.com.ar en este canal.',
      '',
      '2. Para cerrar la venta, el camino es DIRECTO: vos tomás los datos (nombre, dirección, forma de pago) y el equipo le carga el pedido en el CRM. NO redirijas al cliente a "podés comprarlo en nuestra tienda" sin link concreto de TiendaNube — eso lo deja perdido.',
      '',
      '3. Tono más relajado que en ML — voseo, emojis ocasionales aceptados, contracciones, español rioplatense. Pero seguís siendo Lucas: no uses cierres de oficina formal ("Quedo a disposición", "Atentamente", "Cordialmente"). El cierre natural es algo tipo "Cualquier cosa avisame" o simplemente sin cierre cuando la conversación está fluyendo.',
      '',
      '4. La identidad: representás a Servifibras directamente, no a una publicación específica. Podés mencionar la web/tienda propia (tiendaservifibras.com), el local, el rango de horarios — info que en ML está prohibida acá es libre.',
      '',
    ].join('\n');
  }
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
      '   Otro caso real (Marcos 2026-06-22, publicación MLA3221254752 "Resina Cristal Epoxi 1:1 con Filtro UV 500 ml"). Comprador preguntó "Cuánto metro cubre el pote". El agente respondió "No puedo responder sin saber exactamente qué producto estás mirando. Esta publicación es de Resina Cristal Epoxi 1:1 Con Filtro UV 500 ml — un kit que trae 250 ml de Parte A + 250 ml de Parte B. ¿Es para eso que preguntás? Si es así, te digo que el rendimiento depende del espesor..." — todo el preámbulo de "no puedo responder sin saber" + "¿es para eso que preguntás?" es violación directa de esta regla. La respuesta debió arrancar derecho con el rendimiento del kit de 500 ml de ESTA publicación. PROHIBIDO también los preámbulos "No puedo responder sin saber", "Necesito saber qué producto", "Antes de responder, contame", "¿Es para eso que preguntás?", "Si es así, te digo" — son todas variantes de pedir identificación que la regla prohíbe.',
      '   Noveno caso real (Marcos 2026-07-01, publicación MLA2736866806 "Resina Cristal Epoxi Con Filtro Uv Protección Solar 2 Unidades De 500ml Mezcla 1 A 1"). Comprador OSCAREDUARDOHUNZIKER preguntó "Hola! Que tal? Te consulto, está resina es en proporción 1 a 1 en peso ?". El agente respondió "Exacto, 1 a 1 en volumen — 500 ml de Parte A + 500 ml de Parte B. Si lo querés en peso, los dos componentes pesan prácticamente lo mismo (aproximadamente 1:1 también), así que para cálculos rápidos podés asumir que son equivalentes...". VIOLACIÓN DE HECHO. La pregunta era ESPECÍFICAMENTE "en peso" y la respuesta correcta es NO. La proporción 1:1 de las resinas epoxi de Servifibras está siempre especificada EN VOLUMEN (ml de Parte A + ml de Parte B, se mide con vasos medidores o jeringa). En peso NO es 1:1 — la Parte A (resina) y la Parte B (endurecedor) tienen densidades distintas. PROHIBIDO ABSOLUTAMENTE inventar/aproximar/asumir que un producto especificado 1:1 en volumen también es 1:1 en peso — es un error técnico grave que puede arruinar la mezcla del cliente (endurece mal, queda pegajosa, no cura). PROHIBIDO decir "aproximadamente 1:1 también", "pesan prácticamente lo mismo", "para cálculos rápidos podés asumir que son equivalentes" o cualquier variante. La respuesta correcta: "No, la proporción 1:1 de esta resina es EN VOLUMEN (500 ml de Parte A + 500 ml de Parte B, se mide con vasos medidores o jeringa). En peso NO es 1:1 porque los componentes tienen densidades diferentes, por eso la mezcla se especifica siempre en volumen. Si necesitás la equivalencia en peso, contame y te pasamos la densidad de cada parte." REGLA GENERAL: para todas las resinas y siliconas bi-componente de Servifibras (epoxi 1:1, epoxi 2:1, silicona A+B, poliéster + catalizador), la proporción publicada es SIEMPRE en volumen salvo que la publicación explícitamente diga "en peso" o "por peso" o "gr Parte A + gr Parte B". Si el comprador pregunta por proporción en peso, la respuesta es siempre: "la proporción está especificada en volumen, en peso no es equivalente, mezclá con vasos medidores".',
      '   Octavo caso real (Marcos 2026-06-29, publicación MLA1480426253 "2kg Caucho De Silicona Base Platino 00 Shore A+b Para Moldes"). Compradora MALVINAPICCINELLI preguntó "Hola... tendrian el kit completo? Queria todos los productos para preparar el molde con la mano de mi hija y luego verterle la silicona..". La pregunta es CLARA — la compradora explicó el caso de uso completo: hacer un molde de la mano de su hija y después verter silicona dentro del molde para reproducirla. El agente respondió "Necesito entender mejor qué kit buscás. La pregunta llega en esta publicación de Caucho de Silicona 2kg — pero \'kit completo para preparar molde\' puede significar varias cosas. ¿Me confirmas qué querés hacer exactamente? - Hacer un molde (usar silicona para copiar un objeto) → necesitarías silicona + desmoldante + vasos medidores + espátulas". TRES violaciones a la vez: (1) "Necesito entender mejor qué kit buscás" es ask-back de clarificación prohibida por regla 5.B — la pregunta YA tiene contexto completo; (2) "puede significar varias cosas" es ambiguity-dodge — el agente tiene que elegir la lectura más probable Y responderla, no listar las posibilidades; (3) "¿Me confirmas qué querés hacer exactamente?" cierra con pregunta abierta — regla 7 prohíbe. La respuesta correcta arranca con la confirmación + el set de productos: "Sí, este Caucho de Silicona Platino 2kg es ideal para sacar el molde de la mano de tu hija (es food-safe en versión platino y captura todo el detalle de la piel). Para el flujo completo necesitás: el caucho de silicona (parte A+B, vienen en el kit de esta publicación) + un recipiente para contener la mano + desmoldante (si después vas a verter más silicona o resina dentro del molde). Si para el vaciado interior pensás usar resina o silicona pigmentada, te conviene también nuestro [link al pigmento que corresponda]. Para 1 mano de niña con 2kg de silicona te alcanza tranquilo." — específico al caso de uso que la compradora dio, no lista genérica.',
      '   Séptimo caso real (Marcos 2026-06-27, publicación MLA1479241347 "Resina Epoxi Revestimiento 1kg Cristal Vidrio Liquido 2:1 Ideal Para Artesanías"). Comprador (Juliomar) preguntó "cual es el recomendable para hacer una pequeña lámina para pequeños cartelitos?". El agente respondió "Para carteles pequeños, el ancho ideal es 1,10 m o 1,22 m con espesor de 1,5 mm o 2 mm... 1,10 m × 1,5 mm → opción más económica..." — eso es respuesta de LAMINADOS PRFV (placas de fibra de vidrio rígidas), NO de la RESINA EPOXI de esta publicación. El agente cruzó la pregunta con otra categoría de producto y contestó como si la publicación fuera de placas. PROHIBIDO ABSOLUTAMENTE: la pregunta del comprador SIEMPRE se interpreta en el contexto de la publicación que está mirando. Si está en una publicación de Resina Epoxi y pregunta por "lámina para cartelitos", la lámina es DE RESINA (verter en molde plano para hacer una placa fina), no es un laminado PRFV pre-fabricado. La respuesta correcta hablaba del rendimiento de la resina de esta publicación para hacer una capa fina sobre un cartel (ej. "Con 1 kg de esta resina podés cubrir aprox. 0,5 m² a 2 mm de espesor — alcanza para cartelitos de hasta X cm. Vertés sobre la base y queda con acabado cristalino."). Nunca jamás respondés con info de OTRA categoría de producto que no sea la de la publicación.',
      '   Sexto caso real (Marcos 2026-06-25, publicación MLA3221254752 "Resina Cristal Epoxi 1:1 500 ml"). Comprador preguntó "Hola, cuantos m2 rinde?". El agente respondió "Depende de qué producto estés usando y de qué espesor lo apliques. Para la Resina Cristal Epoxi 1:1 Con Filtro UV de esta publicación (500 ml = 250 ml A + 250 ml B): - A 1 mm de espesor: rinde aprox. 0,5 m² - A 2 mm de espesor: rinde aprox. 0,25 m²..." — el cuerpo tiene los datos correctos PERO la apertura "Depende de qué producto estés usando" sugiere falsamente que necesita más info cuando la publicación ya dice el producto. PROHIBIDO ese opener. La respuesta correcta arranca con el dato directo: "El kit de 500 ml de esta publicación rinde 0,5 m² a 1 mm de espesor y 0,25 m² a 2 mm." Sin "depende de qué producto", sin "para la resina de esta publicación" como rodeo — el agente ya sabe qué producto es.',
      '   Quinto caso real (Marcos 2026-06-24, publicación MLA2856630688 "Resina Epoxi Cristal 6 L"). Comprador preguntó "Hola, cual sería el volumen que ocupa? Saludos". El agente respondió "No especificás de qué volumen me preguntás — ¿es el volumen del paquete que ves en la publicación, o cuánto espacio ocupa cuando vertés la resina en un molde? Si es el tamaño físico del envase: 29,2 × 23,8 × 22,8 cm. Si es el volumen de resina útil: 6 litros (4 L Parte A + 2 L Parte B)." — la pregunta era ambigua entre dos lecturas y el agente PIDIÓ aclaración antes de responder, cuando ya tenía ambas respuestas listas debajo. PROHIBIDO. Si la pregunta admite dos lecturas y ambas se pueden contestar con info de la publicación, contestás LAS DOS de una sin pedir aclaración: "La caja mide 29,2 × 23,8 × 22,8 cm. El contenido útil son 6 litros de resina (4 L Parte A + 2 L Parte B)." Sin "no especificás", sin "¿es el X o el Y?", sin pedir al comprador que elija.',
      '   Cuarto caso real (Marcos 2026-06-24, publicación MLA1713128062 "Caucho silicona RTV20 Shore A 1/2 kg"). Comprador preguntó "Viene en 2k o de 5k?" — pregunta puntual yes/no sobre presentación. El agente respondió "Esta publicación ofrece el caucho de silicona RTV 20 Shore A Base Platino en presentación de 1/2 kg (250 g componente A + 250 g componente B). Si necesitás una presentación más grande, tenemos: - 2 kg — ARS 81.000 - 10 kg (kit completo)..." — empezó por la presentación de la propia publicación pero NO contestó directo el "2k o 5k". La respuesta correcta arranca con un NO claro y propone la alternativa: "No, esta publicación es de 1/2 kg. La presentación de 2 kg la tenés acá: [link MLA del de 2kg]. De 5 kg no manejamos como tal; el siguiente paso es 10 kg si te interesa." REGLA: cuando el comprador hace una pregunta yes/no o de elección puntual (¿viene en X o Y?, ¿es para Z?, ¿sirve para W?), la primera oración tiene que ser la respuesta directa (sí/no/cuál). La info adicional (otras presentaciones, alternativas, links) va después. NO arrancar con "Esta publicación es..." cuando la pregunta no es "qué es esta publicación".',
      '   Tercer caso real (Marcos 2026-06-23, publicación MLA1588195697 "Pigmentos"). Comprador (Mirmaza) preguntó "Hola te compré los pigmentos pero sirve para jabones porq dice para resina". El agente respondió "La búsqueda devolvió moldes y pigmentos para resina, no colorantes especificos para jabón. En nuestro perfil de tienda de MercadoLibre podés buscar entre los productos si ofrecemos colorante apto para jabón, o consultame directamente qué uso le querés dar — tal vez podamos orientarte mejor. ¿Los pigmentos que compraste los querías para teñir la resina, o ya estabas buscando otra cosa para los jabones?" — TRES violaciones a la vez: (1) "La búsqueda devolvió" expone vocabulario interno de la herramienta buscar_producto, jamás llega al comprador; (2) "podés buscar entre los productos" + "consultame directamente qué uso" pasan la pelota al comprador en vez de responder; (3) "¿Los pigmentos que compraste los querías para teñir la resina, o ya estabas buscando otra cosa?" es exactamente la pregunta de clarificación que esta regla prohíbe — la publicación dice "para resina" y el comprador YA aclaró que compró estos, hay que responder con la propiedad técnica del pigmento (compatibilidad con jabón sí/no) y si no es compatible, buscar_producto interno + linkear el alternativo. La respuesta correcta arranca con la propiedad del producto: "Esos pigmentos son específicos para resina epoxi/poliéster — no se recomiendan en jabón porque [razón técnica]. Para jabones conviene [colorante apto]: [link]."',
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
      '',
      '9. ⚠️ ABSOLUTAMENTE PROHIBIDO TIPEAR ETIQUETAS / VOCABULARIO INTERNO EN LA RESPUESTA AL CLIENTE.',
      'Marcos 2026-06-18 PM (caso real, publicación MLA629833763 — pregunta "Este producto es líquido"):',
      'El agente respondió con el texto literal "RECLAMO DETECTADO — SILENCIO TOTAL / Recibí un reclamo de MercadoLibre (ID: 5530195211) clasificado como N3 (postventa / defensa del consumidor). Equipo de ServiFibras: revisar reclamo #5530195211 — cliente BRATINPABLO20230120115650, motivo PNR9501, estado cerrado con decisión a favor del reclamante." — ese texto es INTERNO, son las etiquetas que usa este prompt para clasificar y enrutar. NUNCA tiene que aparecer en la respuesta al comprador. Confunde, asusta, viola TOS de ML y arruina la marca.',
      '',
      'NUNCA, BAJO NINGUNA CIRCUNSTANCIA, escribas en la respuesta:',
      '  - "RECLAMO DETECTADO", "SILENCIO TOTAL", "DERIVACIÓN", "ESCALAMIENTO", "ESCALAR A HUMANO"',
      '  - "N1", "N2", "N3" (niveles de complejidad internos)',
      '  - "Equipo de ServiFibras: revisar…", "Equipo: revisar…", "el equipo va a revisar", o cualquier mensaje DIRIGIDO al equipo interno',
      '  - "clasificado como", "motivo PNR", "PNR{numero}", "ID de reclamo {numero}", "expediente"',
      '  - "defensa del consumidor", "postventa", "decisión a favor del reclamante"',
      '  - "Quedo a disposición ante cualquier otra duda" (cierre de oficina formal, prohibido — usá el cierre canónico del prompt)',
      '  - Marcos 2026-06-23: vocabulario de la herramienta buscar_producto en el cuerpo de la respuesta. PROHIBIDO escribir "La búsqueda devolvió X", "los resultados de la búsqueda son Y", "el catálogo devolvió", "busqué en el catálogo y...", "la herramienta arrojó...", "no encontré en el sistema". La herramienta es interna; el comprador no sabe que existe. Si querés decir "no tenemos ese producto", decilo así: "No tenemos ese colorante para jabón" — no "La búsqueda no devolvió colorantes para jabón". Si encontraste un alternativo, presentalo como propio: "Para jabón te conviene [X] — [link]", no "la búsqueda devolvió [X]".',
      '  - Marcos 2026-06-23: variantes de pedir al comprador más información antes de responder. PROHIBIDO "consultame directamente qué uso", "contame qué necesitás", "podés buscar entre los productos", "fijate vos si te sirve". Tu trabajo es responder con lo que la publicación + la pregunta ya te dan; si el caso requiere un alternativo, buscalo VOS con buscar_producto y pegalo en la respuesta.',
      '',
      'Esas son palabras del MANUAL OPERATIVO que ves en este prompt — sirven para que VOS sepas QUÉ hacer, no son texto para repetir al cliente. Si la pregunta del comprador es legítima sobre el producto (como "Este producto es líquido"), respondela en términos del producto — no proceses la pregunta como un reclamo aunque alguna palabra te lo sugiera.',
      '',
      'Regla de oro: la respuesta que enviás al cliente jamás debería parecer una nota de operaciones internas, un log, un email al equipo, ni un mensaje técnico. SIEMPRE es una respuesta natural, en español rioplatense, dirigida al comprador en segunda persona ("vos / podés / tenés"), sobre el producto.',
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
  // Marcos 2026-07-13 (A2 del documento): whitelist explícita de
  // permalinks de publicaciones ML que sabemos que existen en el
  // catálogo. Antes cualquier URL con dominio mercadolibre.com/.com.ar
  // pasaba el filtro por regex de dominio — el agente podía inventar
  // MLA-XXXXX y salía como link válido. Ahora se compara URL cruda
  // contra este Set (más el store profile como caso puntual).
  private validMlPermalinks: Set<string> = new Set();
  private static readonly ML_STORE_PROFILE_URL =
    'https://www.mercadolibre.com.ar/tienda/servifibras';
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
      // Marcos 2026-07-13 (A2): armamos el Set de permalinks ML
      // válidos desde el mapa de catálogo. Al normalizar acá (una vez
      // por refresh) evitamos hacerlo en cada scrub de respuesta.
      const permalinks = new Set<string>();
      for (const ml of mlMap.values()) {
        if (ml) {
          const norm = ml.replace(/\/$/, '');
          permalinks.add(norm);
          permalinks.add(norm + '/');
        }
      }
      this.validMlPermalinks = permalinks;
      this.logger.log(
        `✅ KB loaded; ${urls.size} valid product URLs whitelisted, ${mlMap.size} with ML permalink, ${permalinks.size / 2} unique ML permalinks in A2 allowlist`,
      );
    } catch (error) {
      this.logger.error('Failed to load knowledge base', error);
      this.knowledgeBaseContext = null;
      this.validCatalogUrls = new Set();
      this.catalogUrlToMlPermalink = new Map();
      this.validMlPermalinks = new Set();
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
    // Marcos 2026-06-24: en canales privados (WhatsApp/FB/IG/webchat)
    // NUNCA mandar links de Mercado Libre. El cliente ya está hablando
    // con nosotros; reenviarlo a ML pierde el lead + agrega comisión.
    // Si el agente igual los emite (porque el catálogo tiene MLA
    // permalinks), los strippeamos acá y los reemplazamos por el link
    // de TiendaNube correspondiente (lookup reverso de catalogUrlToMlPermalink)
    // si existe, o por una nota neutra.
    const isPrivateChannel =
      channel === Channel.WHATSAPP ||
      channel === Channel.FACEBOOK ||
      channel === Channel.INSTAGRAM ||
      channel === Channel.TIENDANUBE_WEBCHAT;
    const mlToTnLookup = new Map<string, string>();
    if (isPrivateChannel && this.catalogUrlToMlPermalink.size > 0) {
      for (const [tn, ml] of this.catalogUrlToMlPermalink.entries()) {
        if (ml) mlToTnLookup.set(ml.replace(/\/$/, ''), tn);
      }
    }
    if (this.validCatalogUrls.size > 0) {
      cleaned = cleaned.replace(/\bhttps?:\/\/[^\s<>\)\]"',]+/gi, (raw) => {
        const trimmed = raw.replace(/[.,;:!?]+$/, '');
        // Canales privados: cualquier articulo.mercadolibre / mercadolibre.com.ar
        // se reemplaza con TN si lo tenemos mapeado, sino se strippa.
        if (isPrivateChannel && ML_INTERNAL_URL_RE.test(trimmed)) {
          const tnEquivalent = mlToTnLookup.get(trimmed.replace(/\/$/, ''));
          dropped++;
          if (tnEquivalent) {
            this.logger.warn(`ML URL on private channel ${channel} swapped to TN: ${trimmed} → ${tnEquivalent}`);
            return tnEquivalent;
          }
          this.logger.warn(`ML URL on private channel ${channel} stripped (no TN equivalent): ${trimmed}`);
          return '[te lo paso por acá, decime cantidad y zona]';
        }
        // Marcos 2026-07-13 (A2 del documento): antes cualquier URL
        // que matcheara `mercadolibre.com(.ar)` pasaba el filtro por
        // el simple test de dominio. Ahora las URLs de ML tienen que
        // estar en el set de permalinks reales del catálogo, o ser
        // el perfil de tienda oficial. Cualquier URL fabricada del
        // estilo `mercadolibre.com.ar/MLA-XXXXX-inventado` se dropea
        // como una URL inventada más.
        if (ML_INTERNAL_URL_RE.test(trimmed)) {
          const normalized = trimmed.replace(/\/$/, '');
          if (
            this.validMlPermalinks.has(trimmed) ||
            this.validMlPermalinks.has(normalized) ||
            normalized === ClaudeService.ML_STORE_PROFILE_URL
          ) {
            return raw;
          }
          dropped++;
          this.logger.warn(`Fabricated ML URL dropped (not in permalink allowlist): ${trimmed}`);
          return '[link no disponible — pedímelo y te lo paso del catálogo]';
        }
        if (
          this.validCatalogUrls.has(trimmed) ||
          this.validCatalogUrls.has(trimmed + '/') ||
          this.validCatalogUrls.has(trimmed.replace(/\/$/, ''))
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
      // Marcos 2026-07-13 (A1 del documento): la regex vieja solo
      // matcheaba el formato exacto de Buenos Aires (área 11); un
      // teléfono de Córdoba/Rosario/etc. (351/341/261/381...) o un
      // número espaciado dígito por dígito ("1 1 3 5 8 8 0 0 8 3")
      // se colaba entero. Ahora:
      //  A) todas las áreas AR + el 9 opcional del móvil
      //  B) un fallback "10+ dígitos con separadores" que junta
      //     bloques cortos (ej. "1 1", "3 5 8 8", "0 0 8 3") y catchea
      //     el número aunque venga con espacios raros.
      const PHONE_RE = new RegExp(
        [
          // Formato agrupado: +54 (opcional) + 9 (opcional) + área (2-4) + resto.
          '\\b(?:\\+?54\\s*)?9?\\s*(?:11|15|22[0-9]|23[0-9]|26[0-9]|29[0-9]|33[0-9]|34[0-9]|35[0-9]|38[0-9]|11\\d?)' +
          '[\\s.\\-()]*\\d{2,4}[\\s.\\-()]*\\d{2,4}[\\s.\\-()]*\\d{0,4}\\b',
        ].join('|'),
        'g',
      );
      // Fallback: run separate 10+-digit sniffer for spaced-out numbers.
      const PHONE_SPACED_RE = /(?:\d[\s.\-()]{0,3}){9,}\d/g;
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
      // Marcos 2026-07-13 (A1 seguimiento): las regex de teléfono no
      // pueden pisar dígitos que forman parte de una URL válida (los
      // permalinks de ML tienen "MLA-2447450958" — 10 dígitos que
      // matchean la heurística "sequence de 10+"). Chequeamos el
      // contexto previo: si aparece "http[s]://" o "MLA-" en los 80
      // chars anteriores al match, es URL — dejamos pasar.
      const inUrlContext = (haystack: string, offset: number): boolean => {
        const before = haystack.slice(Math.max(0, offset - 80), offset);
        return /https?:\/\/\S*$/.test(before) || /MLA-\d*$/.test(before);
      };
      cleaned = cleaned.replace(PHONE_RE, (raw, offset) => {
        if (typeof offset === 'number' && inUrlContext(cleaned, offset)) return raw;
        dropped++;
        this.logger.warn(`ML scrub: dropped phone number "${raw}"`);
        return '[contacto fuera de MercadoLibre no disponible]';
      });
      // Second pass: catch spaced-out digit sequences that the grouped
      // regex misses ("1 1 3 5 8 8 0 0 8 3").
      cleaned = cleaned.replace(PHONE_SPACED_RE, (raw, offset) => {
        if (typeof offset === 'number' && inUrlContext(cleaned, offset)) return raw;
        const digitCount = (raw.match(/\d/g) ?? []).length;
        if (digitCount < 10) return raw;
        dropped++;
        this.logger.warn(`ML scrub: dropped spaced digit sequence "${raw}"`);
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
    // Marcos 2026-06-22: el loop saca hasta 2 saludos consecutivos
    // por si el modelo emite "Hola X,\nHola X," (visto en algunos
    // drafts) sin volverlo a saludar.
    for (let i = 0; i < 2; i++) {
      const stripped = body.replace(/^Hola[^\n,.!?]{0,80}[,.\n]\s*/i, '').trim();
      if (stripped === body) break;
      body = stripped;
    }
    // Marcos 2026-06-22: signoff dedupe ampliado para todas las
    // variantes que el modelo a veces emite además del canónico —
    // 'Saludos cordiales', 'Atte. Lucas', 'Cordialmente', 'Saludos
    // atentos', 'Atentamente', etc. Cada uno consume desde el
    // principio de la última línea hasta el fin del body. Loop 2x
    // por si emite dos seguidos.
    const SIGNOFF_PATTERNS: RegExp[] = [
      /\n*Un\s+saludo,?\s+Lucas\s+de\s+Servifibras\.?\s*$/i,
      /\n*Un\s+(?:cordial\s+)?saludo[,.]?\s*$/i,
      /\n*Saludos(?:\s+(?:cordiales|atentos|cordiales\s+y\s+atentos))?[,.]?\s*$/i,
      /\n*Atentamente[,.]?\s*$/i,
      /\n*Cordialmente[,.]?\s*$/i,
      /\n*Atte\.?\s+Lucas[^\n]*\.?\s*$/i,
      /\n*Atte\.?[,.]?\s*$/i,
      /\n*Lucas\s+de\s+Servifibras\.?\s*$/i,
      /\n*Quedo a disposici[oó]n[^\n]*\.?\s*$/i,
      /\n*Cualquier\s+(?:otra\s+)?(?:consulta|duda)[^\n]*\.?\s*$/i,
      /\n*Estoy\s+a\s+(?:tu\s+)?disposici[oó]n[^\n]*\.?\s*$/i,
    ];
    for (let i = 0; i < 2; i++) {
      let changed = false;
      for (const re of SIGNOFF_PATTERNS) {
        const stripped = body.replace(re, '').trim();
        if (stripped !== body) {
          body = stripped;
          changed = true;
        }
      }
      if (!changed) break;
    }

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

    // Marcos 2026-07-13 (B1): pasamos el mensaje entrante del buyer
    // al selector de estilo así rankea las correcciones por similitud
    // con la consulta actual (no por fecha). Antes se ignoraba y sólo
    // entraban las N más recientes por priority + createdAt.
    const styleBlock = await this.conversationStyle.buildSystemPromptBlock(
      undefined,
      turn?.channel,
      newMessage,
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
      } else {
        // Marcos 2026-06-18 PM: cuando fetchListingDetails devuelve
        // null (cuenta sin permisos, publicación dada de baja, fallo
        // de red de un solo intento), antes el agente quedaba sin
        // ningún anclaje y respondía "¿sobre qué producto me estás
        // preguntando?". Esa pregunta no la podemos hacer — el
        // comprador YA está en una publicación específica de ML;
        // preguntárselo se lee como "no sé dónde estás parado". Este
        // bloque le da al agente reglas de fallback para extraer
        // contexto de la pregunta misma en vez de pedirlo.
        systemBlocks.push({ type: 'text', text: mlListingMissingContextBlock() });
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
      // Marcos 2026-06-18 PM: el corte a mitad de oración seguía
      // apareciendo en publicaciones que no son laminado, no solo en
      // PRFV. El clasificador de complejidad seguía routing varias
      // preguntas como L1 y 600 tokens NO alcanzan cuando la respuesta
      // incluye link cross-publicación + cierre obligatorio.
      // Unifico el techo: L1/L2/L3 todos usan el mismo cap por defecto
      // (REPLY). La complejidad sigue eligiendo modelo más barato para
      // L1 (eso es donde el ahorro real está); el techo de tokens no
      // tiene que castigar a la inversa. .env sigue siendo el override.
      const ceiling = this.maxTokens('CLAUDE_MAX_TOKENS_REPLY', 1024);
      if (lvl === 1) return this.maxTokens('CLAUDE_MAX_TOKENS_REPLY_L1', ceiling);
      if (lvl === 2) return this.maxTokens('CLAUDE_MAX_TOKENS_REPLY_L2', ceiling);
      return ceiling;
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
    // Marcos 2026-06-18 PM: hard guard contra fugas de etiquetas
    // internas (RECLAMO DETECTADO / SILENCIO TOTAL / Equipo de
    // ServiFibras: revisar / PNR{n} / N1-N3). Si el modelo escupe
    // texto de manual operativo, reemplazamos por un fallback
    // benigno — mejor que el operador vea "Gracias por consultar…"
    // y reescriba a mano, que el comprador reciba el log interno.
    // Corre PRIMERO antes que cualquier otra transformación porque
    // si hay fuga, todo el texto se descarta y no tiene sentido
    // procesarlo más.
    const sanitized = this.guardAgainstInternalClassificationLeak(rawText, turn);
    const guarded = this.dropFabricatedUrls(sanitized, turn?.channel);
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
   * Marcos 2026-06-18 PM: catch fugas de vocabulario de clasificación
   * interna en la respuesta al cliente (caso real MLA629833763 —
   * "RECLAMO DETECTADO — SILENCIO TOTAL" + "Equipo de ServiFibras:
   * revisar reclamo #…"). Esas son palabras del prompt que el modelo
   * a veces parrotea — para el comprador son ininteligibles y violan
   * TOS de ML.
   *
   * Si detectamos al menos UN patrón rojo, reemplazamos toda la
   * respuesta por un fallback genérico — feo, pero no dañino. El
   * operador del panel QA lo ve, lo reescribe a mano y envía. El
   * draft NO llega al comprador (todos los drafts pasan por
   * pendingReview en ML).
   */
  private guardAgainstInternalClassificationLeak(
    rawText: string,
    turn?: import('../../use-cases/ai/ai.interface').AITurnContext,
  ): string {
    if (!rawText || rawText.length === 0) return rawText;
    // Patrones literales del manual operativo que NUNCA deben aparecer
    // en una respuesta dirigida al cliente. Una sola coincidencia
    // basta para descartar todo el texto.
    const FORBIDDEN: RegExp[] = [
      /\bRECLAMO\s+DETECTADO\b/i,
      /\bSILENCIO\s+TOTAL\b/i,
      /\bDERIVACI[ÓO]N\s+(?:A\s+)?(?:HUMANO|EQUIPO)\b/i,
      /\bESCALAR\s+(?:A\s+)?(?:HUMANO|N\d)\b/i,
      // "Equipo de ServiFibras: revisar …" — el agente le habla al
      // equipo interno en vez de al comprador.
      /\bEquipo\s+de\s+(?:ServiFibras|Servifibras|servifibras)\s*:\s*/i,
      /\bel\s+equipo\s+va\s+a\s+revisar\b/i,
      // PNR + dígitos / ID de reclamo con número
      /\bPNR\s*\d{2,}\b/i,
      /\bID\s*(?:de\s+)?reclamo\s*[:#]?\s*\d{3,}/i,
      // "clasificado como N1/N2/N3"
      /\bclasificad[oa]\s+como\s+N[123]\b/i,
      // "defensa del consumidor" — terminología interna de
      // clasificación, no vocabulario de comprador
      /\bdefensa\s+del\s+consumidor\b/i,
      // "decisión a favor del reclamante" — texto de log
      /\bdecisi[óo]n\s+a\s+favor\s+del\s+reclamante\b/i,
    ];
    for (const pattern of FORBIDDEN) {
      if (pattern.test(rawText)) {
        this.logger.error(
          `⛔ Filtro anti-leak: la respuesta del agente contenía vocabulario interno (${pattern.source}). ` +
          `Reemplazada por fallback. Texto descartado (primeros 200 chars): "${rawText.slice(0, 200).replace(/\n/g, ' ')}"`,
        );
        if (turn?.channel === Channel.MERCADOLIBRE) {
          // El operador ve el fallback en el panel QA y reescribe.
          // El draft NO llega al comprador (review-mode).
          return '¡Gracias por escribirnos! En un momento te respondemos esta consulta con el detalle que necesitás.';
        }
        return 'Gracias por escribirnos, en un momento te respondemos.';
      }
    }
    return rawText;
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
      // Marcos 2026-06-22 (MLA660365549 — "Hola Catalanoantito, Veo
      // que preguntás cómo se usa la Resina Cristal Vidrio Líquido.
      // Asumo que con '2x1' te referís..."): preámbulo de
      // reformular-la-pregunta antes de responder. Es ruido — el
      // comprador ya sabe qué preguntó.
      { name: 'veo que <verbo-2p>', re: /^\s*(?:Bueno,?\s*)?[Vv]eo que (?:pregunt[aá]s|quer[eé]s|necesit[aá]s|busc[aá]s|est[aá]s|me pregunt|me ped[ií]s|mencion[aá]s|consult[aá]s|comentas)[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'asumo que', re: /^\s*(?:Bueno,?\s*)?[Aa]sumo que[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'entiendo que', re: /^\s*(?:Bueno,?\s*)?[Ee]ntiendo que[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'interpreto que', re: /^\s*(?:Bueno,?\s*)?[Ii]nterpreto que[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'noto que', re: /^\s*(?:Bueno,?\s*)?[Nn]oto que[^,.!?\n]*[,.!?\n]+\s*/g },
      { name: 'parece que', re: /^\s*(?:Bueno,?\s*)?[Pp]arece que[^,.!?\n]*[,.!?\n]+\s*/g },
      // Marcos 2026-06-22 (MLA3221254752 — "No puedo responder sin
      // saber exactamente qué producto estás mirando. Esta publicación
      // es de Resina Cristal Epoxi..."): otra forma de pedir
      // identificación de producto. La publicación YA es el producto;
      // este preámbulo viola la regla 5.B. Strip primera oración.
      { name: 'no puedo responder sin saber', re: /^\s*[Nn]o puedo responder (?:sin|hasta|si no)[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-27 (MLA2040077132 — pregunta sobre uso del
      // producto en caños de gas / aprobación Metrogas). Agente
      // arrancó con "No puedo responder esa consulta con la
      // información que tengo disponible. Las normativas de
      // seguridad para sistemas de gas son muy específicas y
      // requieren una validación técnica profesional...". Misma
      // forma de declinar pero variante que NO matchea sin/hasta/si
      // no — usa "esa/esta/tu/la consulta". Strip de toda la oración
      // de apertura.
      { name: 'no puedo responder esa consulta', re: /^\s*[Nn]o puedo responder (?:esa|esta|tu|la)[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'necesito saber qu[eé]', re: /^\s*[Nn]ecesito saber (?:qu[eé]|cu[aá]l)[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'antes de responder', re: /^\s*[Aa]ntes de (?:responder|contestar|poder contestarte)[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-29 (MLA1480426253 — "tendrian el kit completo?
      // Queria todos los productos para preparar el molde con la mano
      // de mi hija y luego verterle la silicona"). El agente respondió
      // "Necesito entender mejor qué kit buscás. La pregunta llega en
      // esta publicación de Caucho de Silicona 2kg — pero 'kit
      // completo para preparar molde' puede significar varias cosas.
      // ¿Me confirmas qué querés hacer exactamente?". La pregunta era
      // clara — la compradora explicó el caso de uso (molde de mano
      // de su hija, después verter silicona). Misma familia de
      // ask-back que se viene marcando. Strip de las tres formas que
      // aparecieron juntas en este caso.
      { name: 'necesito entender mejor', re: /^\s*[Nn]ecesito\s+entender\s+mejor[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'puede significar varias cosas', re: /\s*[Pp]ero\s+["“'].+?["”']\s+puede\s+significar[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'puede significar varias (suelto)', re: /\s*[Pp]uede\s+significar\s+varias\s+cosas[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-29 (MLA2856630688 — pregunta sobre temperatura
      // de la resina). El agente arrancó con "¿Estás preguntando si
      // esta Resina Epoxi Cristal de Altos Espesores (la publicación
      // que estás mirando) resiste temperaturas altas? Sí, resiste —
      // aguanta hasta 200°C...". El prefijo de clarificación es
      // redundante (la pregunta es lo que es) y violatorio de la
      // regla one-shot — strip del "¿Estás preguntando si...?" antes
      // del "Sí, resiste".
      { name: 'estas preguntando si', re: /^\s*¿\s*[Ee]st[áa]s\s+preguntando\s+si[^?]*\?\s*/g },
      // Marcos 2026-06-30 (MJ20260629134155 caso real, MERCADOLIBRE):
      // el agente arrancó una pre-venta ML con "¡Hola! Soy Lucas, el
      // asistente de ventas de ServiFibras. ¿En qué te puedo ayudar?".
      // Doble violación: (1) el comprador no preguntó nada concreto
      // todavía (saludo solo), pero el agente igual tiene que dar
      // valor desde el contexto de la publicación que está mirando
      // — no devolver pregunta abierta; (2) "¿En qué te puedo ayudar?"
      // es closing-question prohibido por [[ml-not-conversational]]
      // — ML Q&A es one-shot, no hay vuelta. Strip de la pregunta
      // (deja la presentación + cualquier saludo limpios).
      { name: '¿en qué te puedo ayudar? (closing)', re: /¿\s*[Ee]n\s+qu[ée]\s+(?:m[áa]s\s+)?te\s+puedo\s+ayudar[^?]*\?\s*/g },
      { name: 'necesitás algo más / alguna otra duda', re: /¿\s*(?:[Nn]ecesit[áa]s\s+algo\s+m[áa]s|[Tt]en[ée]s\s+alguna\s+otra\s+(?:duda|pregunta)|[Aa]lguna\s+otra\s+(?:duda|consulta|pregunta))[^?]*\?\s*/g },
      // Marcos 2026-06-30 (sweep cross-channel post-deploy): caso
      // real IZEV9995675 ML — agente cerró con "Si necesitás algo
      // más o tenés dudas al trabajar con la resina, avisame.
      // Quedo a disposición ante..." que es CIERRE DECLARATIVO
      // (no pregunta) violando la regla one-shot de ML. El strip
      // anterior solo agarraba la variante con ¿?. Catch el
      // declarativo también, sea con "avisame" / "escribime" /
      // "quedo a disposición" / "consultame" del lado del que
      // cierra.
      { name: 'si necesitás algo más (declarativo)', re: /[Ss]i\s+necesit[áa]s\s+(?:algo\s+m[áa]s|cualquier\s+(?:otra\s+)?(?:duda|consulta))[^.!?\n]*(?:avis[áa]me|escr[ií]b[ií]me|consult[áa]me|quedo\s+a\s+disposici[oó]n|estoy\s+a\s+disposici[oó]n)[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'cualquier duda / consulta avisame', re: /[Cc]ualquier\s+(?:otra\s+)?(?:duda|consulta|pregunta)[^.!?\n]*(?:avis[áa]me|escr[ií]b[ií]me|consult[áa]me|qued(?:o|amos)\s+a\s+disposici[oó]n)[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-07-02 (audit de overnight ML QA): ~5 de 20 respuestas
      // cerraban con "Quedo a disposición ante cualquier otra duda." como
      // filler final. La regla 7 del prompt lo prohíbe explícitamente
      // ("Quedo a disposición") pero el modelo lo emite igual — cerró así:
      //   - "Te comparto la publicación del paño ... Quedo a disposición..."
      //   - "Este molde es ideal para un reloj ... Quedo a disposición..."
      //   - "La náutica es la indicada... Quedo a disposición..."
      // Strip por regex, cualquiera sea la posición. Sin anchor de inicio
      // ni de fin — la variante como cierre queda cubierta por [.!?\n]+.
      { name: 'quedo a disposición (closer)', re: /\s*[Qq]uedo\s+a\s+(?:tu\s+)?disposici[oó]n[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'quedamos a disposición (closer)', re: /\s*[Qq]uedamos\s+a\s+(?:tu\s+)?disposici[oó]n[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'estoy a disposición (closer)', re: /\s*[Ee]stoy\s+a\s+(?:tu\s+)?disposici[oó]n[^.!?\n]*[.!?\n]+\s*/g },
      // "Ante cualquier consulta / duda, quedamos / estamos" — variante
      // sin el verbo "quedo" al arranque.
      { name: 'ante cualquier consulta/duda ... (closer)', re: /\s*[Aa]nte\s+cualquier\s+(?:otra\s+)?(?:duda|consulta|pregunta)[^.!?\n]*(?:qued(?:o|amos)|est(?:oy|amos)|escr[ií]b[ií]me|avis[áa]me|consult[áa]me)[^.!?\n]*[.!?\n]+\s*/g },
      // Caso CANCITO11 ML — agente abrió con "Necesito que me
      // aclares qué medidas buscás exactamente". Variante del
      // ask-back con "necesito que me <verbo>" en vez de
      // "necesito entender".
      { name: 'necesito que me aclares/confirmes/digas', re: /^\s*[Nn]ecesito\s+que\s+me\s+(?:aclares|confirmes|digas|cuentes|indiques|expliques)[^.!?\n]*[.!?\n]+\s*/g },
      // Caso JULIOMAR_GARCIA ML — agente abrió con "Depende del
      // tamaño exacto que necesites". Passive clarification —
      // simula que el agente necesita más info cuando la
      // publicación ya tiene contexto suficiente. Strip de la
      // primera oración para que el reply arranque con el dato real.
      { name: 'depende del / de la (clarificación pasiva)', re: /^\s*[Dd]epende\s+(?:de\s+(?:la|los|las)|del?)\s+(?:tama[ñn]o|cantidad|espesor|grosor|ancho|metros?|kg|kilos|gramos|litros?|color|aplicaci[oó]n|uso|proyecto)\s+(?:exact[ao]|que|espec[ií]fic[ao])[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-30 (AG20250326122746 caso real, MERCADOLIBRE):
      // ML pre-venta — el agente arrancó con "Hola Ag, Necesito un
      // poco más de info para cotizarte exacto: 1. ¿Qué ancho? 2.
      // ¿Qué espesor? 3. …". Lista numerada de clarificaciones
      // viola one-shot (el comprador NO va a volver a contestar
      // cada pregunta del listado). Para laminados configurables
      // el agente tiene que mostrar el GRID de precios completo
      // (matriz ancho × espesor) y dejar que el comprador elija,
      // no preguntar uno por uno. Strip del leading + las preguntas
      // numeradas; el resto del reply (que suele tener la tabla
      // efectiva) queda intacto. Si después del strip queda vacío,
      // el caller cae al fallback ML estándar.
      { name: 'necesito un poco más de info para cotizarte', re: /[Nn]ecesito\s+(?:un\s+poco\s+)?m[áa]s\s+(?:de\s+)?info(?:rmaci[oó]n)?\s+para\s+(?:cotizarte|asesorarte|ayudarte|presupuestarte)[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-30: misma familia con verbos alternativos
      // ("Para poder cotizarte necesito saber..." / "Antes de
      // cotizarte tenés que decirme...").
      { name: 'para poder cotizarte necesito', re: /(?:[Pp]ara\s+(?:poder\s+)?(?:cotizarte|presupuestarte|asesorarte)\s+(?:exacto|bien|mejor)?\s*(?:necesito|tengo\s+que|me\s+falta))[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-24 (MLA2856630688 — "Hola, cual sería el volumen
      // que ocupa? Saludos"): el agente arrancó con "No especificás de
      // qué volumen me preguntás — ¿es el volumen del paquete que ves
      // en la publicación, o cuánto espacio ocupa cuando vertés...?".
      // Pidió clarificación en vez de responder ambas interpretaciones
      // directas (que ya tenía abajo). Strip de la oración + la
      // pregunta dicotómica que la sigue.
      { name: 'no especificás / no aclaraste', re: /^\s*[Nn]o\s+(?:especific[aá]s|aclar[aá](?:ste|s)|me\s+queda\s+claro|me\s+dec[ií]s)[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-25 (MLA3221254752 "Resina Cristal Epoxi 500ml"):
      // "Depende de qué producto estés usando y de qué espesor lo
      // apliques." — el agente abre la respuesta haciendo creer que
      // necesita más info, cuando en realidad la publicación YA dice
      // qué producto es. Strip de la oración leading "Depende de qué..."
      // que arranca con clarificación pasiva. La SEGUNDA oración suele
      // tener el dato real ("Para la Resina X de esta publicación...").
      { name: 'depende de qué (clarificación pasiva)', re: /^\s*[Dd]epende\s+de\s+(?:qu[eé]|c[uó]mo|cu[aá]l|d[oó]nde)[^.!?\n]*[.!?\n]+\s*/g },
      { name: '¿es X o Y? clarification', re: /^\s*(?:¿|\?)?\s*[Ee]s\s+(?:el|la|lo)\s+[^,?\n]{1,50}(?:que\s+ves\s+en|del\s+paquete|del\s+envase)[^?\n]*\??\s*,?\s*o\s+[^?\n]*\??\s*/g },
      // Marcos 2026-06-23 (MLA1588195697 — "La búsqueda devolvió
      // moldes y pigmentos para resina, no colorantes especificos
      // para jabón. En nuestro perfil de tienda..."): el modelo
      // narra la salida de la herramienta buscar_producto en lugar
      // de usar la info de la publicación. "La búsqueda devolvió"
      // / "Los resultados de la búsqueda" / "el catálogo devolvió"
      // son strings INTERNOS que jamás deberían llegar al comprador.
      { name: 'la búsqueda devolvió/no encontró', re: /^\s*[Ll]a\s+b[uú]squeda\s+(?:devolvi[oó]|no\s+(?:encontr[oó]|devolvi[oó])|arroj[oó]|trajo|retorn[oó])[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'los resultados de la búsqueda', re: /^\s*[Ll]os\s+resultados\s+de\s+(?:la\s+)?b[uú]squeda[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'el catálogo / sistema devolvió', re: /^\s*[Ee]l\s+(?:cat[aá]logo|sistema|inventario)\s+(?:devolvi[oó]|muestra|tiene|arroja)[^.!?\n]*[.!?\n]+\s*/g },
      { name: 'busqué en el catálogo', re: /^\s*[Bb]usqu[eé]\s+(?:en\s+(?:el|nuestro)\s+)?cat[aá]logo[^.!?\n]*[.!?\n]+\s*/g },
      // Marcos 2026-06-22 (caso MLA1500591407 — "Ah, entendido — es una reparación.\nNo, esta resina..."): aperturas pseudo-conversacionales tipo chatbot que reconocen al comprador como si la conversación viniera de antes. En ML cada pregunta es one-shot — no hay nada que "acabar de entender". Estas aperturas son ruido.
      { name: 'ah / entendido / claro', re: /^\s*(?:Ah[,!.]?\s*)?(?:entendido|entiendo|claro|perfecto|listo|ok|okay|de acuerdo|comprendo|ya veo)\s*[—\-,!.]?\s*(?:[^\n.!?]{0,80}[—,.!?\n])?\s*/i },
      { name: 'ah, ...', re: /^\s*Ah[,!]\s*[^\n.!?]{0,60}[,.!?\n]\s*/i },
      { name: 'gracias por (la pregunta / consultarnos / preguntar)', re: /^\s*(?:Muchas\s+)?[Gg]racias\s+por\s+(?:la\s+pregunta|consultarnos|consultar|tu\s+pregunta|preguntar|escribirnos)[^\n.!?]*[,.!?\n]\s*/i },
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
    // Marcos 2026-06-22: scrub body-internal product-identification
    // questions (no aparecen al inicio sino entre oraciones). Patrón:
    // "¿Es (para/por) eso que preguntás?" / "Si es así, ..." opcional.
    // Removemos la pregunta y dejamos lo que viene después (suele ser
    // la respuesta real que ya estaba en el mismo bloque).
    const BODY_CONFIRMATION_RES: RegExp[] = [
      /\s*¿\s*[Ee]s (?:para|por) eso que pregunt[aá]s\??\s*\??\s*/g,
      /\s*¿\s*[EeYy] es (?:para|por) eso[^.!?\n]*\??\s*/g,
      /\s*[Ss]i es as[ií][,.\s]+(?:te|le)\s+(?:digo|cuento|explico|respondo)[^,.\n]*[,.]\s*/g,
      // Marcos 2026-06-23: "La búsqueda devolvió X" / "el catálogo
      // devolvió X" pueden aparecer mid-text después de una primera
      // oración legítima. Tienen que desaparecer en cualquier posición.
      /(?:^|\s)[Ll]a\s+b[uú]squeda\s+(?:devolvi[oó]|no\s+(?:encontr[oó]|devolvi[oó])|arroj[oó]|trajo|retorn[oó])[^.!?\n]*[.!?\n]\s*/g,
      /(?:^|\s)[Ll]os\s+resultados\s+de\s+(?:la\s+)?b[uú]squeda[^.!?\n]*[.!?\n]\s*/g,
      // "consultame directamente qué uso le querés dar" / "consultame
      // qué necesitás" — closures que piden al comprador que aclare
      // antes de responder. La pregunta es one-shot, hay que responder
      // con lo que el contexto da, no pedir mas info.
      /(?:^|\s)(?:o\s+)?[Cc]onsult[aá]me\s+(?:directamente\s+)?(?:qu[eé]|c[oó]mo|cu[aá]ndo|cu[aá]l|para qu[eé])[^.!?\n]*[.!?\n]\s*/g,
      /(?:^|\s)(?:o\s+)?[Cc]ont[aá]me\s+(?:qu[eé]|c[oó]mo|cu[aá]ndo|cu[aá]l|para qu[eé])[^.!?\n]*[.!?\n]\s*/g,
      // "podés buscar entre los productos si ofrecemos X" — pasar la
      // pelota al comprador para que busque el mismo. El agente
      // tiene buscar_producto, lo tiene que hacer el.
      /(?:^|\s)[Pp]od[eé]s\s+buscar\s+entre\s+(?:los|nuestros)\s+productos[^.!?\n]*[.!?\n]\s*/g,
      // Marcos 2026-06-27 (CESARTOMAS — preguntó "venden pigmentos").
      // Agente respondió: "Sí, vendemos pigmentos. ¿Para qué los
      // necesitás — para resina epoxi, poliéster, silicona, o para
      // otro uso?". El "¿Para qué los/las/lo necesitás" + lista de
      // opciones es exactamente la pregunta de clarificación
      // prohibida (regla 7). Strip de la pregunta al final.
      /\s*¿\s*[Pp]ara\s+qu[eé]\s+(?:l[oa]s?\s+)?necesit[áa]s[^?]*\?\s*$/g,
      /\s*¿\s*[Pp]ara\s+qu[eé]\s+(?:proyecto|uso|aplicaci[oó]n)[^?]*\?\s*$/g,
      // Marcos 2026-06-29 (MLA1480426253). "¿Me confirmas qué querés
      // hacer exactamente?" / "¿Me confirmás qué necesitás?" —
      // ask-back de clarificación que la regla 5.B prohíbe.
      /\s*¿\s*[Mm]e\s+confirm[aá]s\s+qu[eé][^?]*\?\s*/g,
      // Marcos 2026-06-29 (MLA2856630688). "¿Hay algo más que
      // necesites saber sobre esta resina?" — open-ended close
      // prohibida en regla 7 pero seguía emitida. Strip trailing.
      /\s*¿\s*[Hh]ay\s+algo\s+m[áa]s\s+que\s+necesit[ea]s[^?]*\?\s*$/g,
      // Marcos 2026-06-24 (caso EDU_SENAC, Resina Epoxi Cristal):
      // cierres de oficina formal ("Quedo a disposición ante cualquier
      // otra duda.", "Quedo a la espera", "Atentamente Lucas", etc).
      // Ya estaban prohibidos en regla 9 del prompt pero el agente
      // los seguía emitiendo — los stripeamos como red de seguridad.
      // Anclados como trailing (al final del texto o de un párrafo).
      /\s*[Qq]uedo\s+a\s+(?:disposici[oó]n|la\s+espera)[^.!?\n]*[.!?]?\s*$/g,
      /\s*[Aa]tentamente[,.]?\s*(?:Lucas|Servifibras)?[^\n]*$/g,
      /\s*[Cc]ordialmente[,.]?\s*(?:Lucas|Servifibras)?[^\n]*$/g,
    ];
    for (const re of BODY_CONFIRMATION_RES) {
      if (re.test(cleaned)) {
        cleaned = cleaned.replace(re, ' ');
        hit = true;
        this.logger.warn('Body confirmation question scrubbed');
      }
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
