// Seed ConversationExample with gold-standard replies extracted from
// the Prometheo screenshots Marcos shared on 2026-05-19. These become
// the few-shot block the system prompt injects on every customer
// reply, so Lucas imitates pattern-by-pattern instead of trying to
// derive ideal behavior from rules.
//
// Each example is a complete multi-turn slice. They cover the failure
// modes Marcos called out: over-asking, missing concrete calculations,
// mentioning SKU codes, not anticipating the next obvious question.
//
// Idempotent: deletes existing examples with the same `scenario` slug
// before re-inserting, so re-running this script after a tweak doesn't
// duplicate.
//
// Run with:
//   cd /home/servifibras/backend && npx ts-node --transpile-only scripts/seed-conversation-examples.ts

import { PrismaClient } from '@prisma/client';

interface Example {
  scenario: string;
  title: string;
  priority: number;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const EXAMPLES: Example[] = [
  {
    scenario: 'mesa-rio-volumen',
    title: 'Mesa de río — cálculo de volumen y recomendación directa',
    priority: 200,
    turns: [
      { role: 'user',      content: 'voy a hacer una mesa de río de 60 x 30 x 10 cm. cuánta resina necesito?' },
      { role: 'assistant', content: 'Para llenarlo solo con resina hasta los 10 cm completos, ese molde (60 x 30 x 10 cm) lleva aprox. 18 litros de resina. Yo contaría entre 18 y 20 L para trabajar cómodo y cubrir pérdidas de mezcla.' },
      { role: 'assistant', content: 'Si quisieras hacerlo más fino, por ejemplo 3 cm de alto serían unos 5,4 L y 4 cm unos 7,2 L.' },
      { role: 'assistant', content: '¿Tenés pensado usar toda la altura o solo una parte para la tapa?' },
      { role: 'user',      content: 'de 3 o 4 centímetros' },
      { role: 'assistant', content: 'A 3 cm de alto: son unos 5,4 litros de resina → yo iría con un kit de 6 L de altos espesores.' },
      { role: 'assistant', content: 'A 4 cm de alto: aprox. 7,2 litros → necesitarías 6 L + 1,5 L (7,5 L en total, para no quedarte corto).' },
      { role: 'assistant', content: 'La resina de altos espesores es ésta: https://www.tiendaservifibras.com/productos/resinaepoxiespesores/ ¿Ya tenés pensado qué tablas le vas a poner o sería maciza solo resina?' },
    ],
  },
  {
    scenario: 'mesa-superficial-asume-espesor',
    title: 'Recubrimiento superficial — asume 1–2 mm sin preguntar',
    priority: 200,
    turns: [
      { role: 'user',      content: 'estoy necesitando resina' },
      { role: 'assistant', content: '¿Para qué proyecto la necesitás? Así te recomiendo la mejor opción.' },
      { role: 'user',      content: 'una mesa' },
      { role: 'assistant', content: '¿Es una mesa con río / encapsulado de madera, o un recubrimiento superficial sobre la tapa?' },
      { role: 'user',      content: 'superficial, 1 m²' },
      { role: 'assistant', content: 'Para recubrimiento superficial en mesa de 1 m², la resina indicada es la Epoxi Cristal — queda transparente y dura, no amarillea. A 1–2 mm de espesor necesitás aprox. 1 a 2 kg de mezcla.' },
      { role: 'assistant', content: 'Te conviene esta: Resina Epoxi Cristal 1:1 con filtro UV — $12.500 el kit de 1 kg. https://www.tiendaservifibras.com/productos/resinaepoxifiltrouv/ Para cubrir 1 m² completo te recomiendo tomar 2 unidades, así tenés margen.' },
      { role: 'assistant', content: '¿La pasás a buscar por el local o te coordinamos envío?' },
    ],
  },
  {
    scenario: 'pileta-reparacion-kit',
    title: 'Reparación de pileta — recomendación directa con kit y opciones por tamaño',
    priority: 180,
    turns: [
      { role: 'user',      content: 'tengo que reparar una pileta de fibra de vidrio, qué necesito?' },
      { role: 'assistant', content: 'Lo más práctico para reparaciones de pileta de fibra es un kit que ya viene con todo: resina poliéster náutica + fibra MAT + catalizador. Te ahorrás de armar la combinación a mano.' },
      { role: 'assistant', content: 'Según el tamaño del daño: si es una grieta o fisura chica, el kit de 1 kg te alcanza ($24.397). Para una zona más grande va el de 4 kg ($66.752). Si la reparación es de superficie importante, mejor el de 10 kg.' },
      { role: 'assistant', content: 'El de 1 kg lo tenés acá: https://www.tiendaservifibras.com/productos/kit-fibra-de-vidrio-servifibras/ ¿De qué tamaño es la grieta más o menos?' },
    ],
  },
  {
    scenario: 'molde-silicona-mesa',
    title: 'Cross-sell — molde de silicona para mesa cuando el cliente está en proyecto de mesa',
    priority: 160,
    turns: [
      { role: 'user',      content: 'quiero hacer una mesa redonda con golosinas adentro' },
      { role: 'assistant', content: 'Tenemos moldes de silicona para mesas justo para eso. El redondo de 42 cm es el que más se usa para esas mesas tipo de diseño con encapsulado. Hoy está $45.000.' },
      { role: 'assistant', content: 'Acá lo ves: https://www.tiendaservifibras.com/productos/molde-silicona-redondo-42cm-mesa-resina-yeso/' },
      { role: 'assistant', content: 'También hay rectangulares grandes y uno triangular tipo mesa de diseño. ¿Qué tamaño tenías en mente?' },
    ],
  },
  {
    scenario: 'altos-espesores-tecnico',
    title: 'Pregunta técnica — capa única vs múltiples coladas',
    priority: 150,
    turns: [
      { role: 'user',      content: 'la resina de alto espesor se puede verter de una sola o tiene que ser por capas?' },
      { role: 'assistant', content: 'Con la resina de altos espesores podés hacer una sola colada para una tapa de mesa estándar — está pensada exactamente para vertidos grandes sin que se deforme ni se queme.' },
      { role: 'assistant', content: 'Si el proyecto es muy alto o muy voluminoso (más de 5–6 cm), conviene hacerlo en 2 o 3 capas para cuidar la temperatura.' },
      { role: 'assistant', content: '¿De qué medida y qué altura querés hacer la mesa? Así te confirmo si va de una o por capas.' },
    ],
  },
  {
    scenario: 'mesa-con-tablas-coladas',
    title: 'Mesa con tablas — instrucción multi-colada proactiva',
    priority: 150,
    turns: [
      { role: 'user',      content: 'la quiero hacer de 60 x 30 x 10 cm con tablas de madera' },
      { role: 'assistant', content: 'Para ese molde (60 x 30 x 10 cm) no te recomiendo volcar los 10 cm de una sola vez, aunque uses resina de altos espesores.' },
      { role: 'assistant', content: 'Más con tablas: primero hacé una capa finita para sellar la madera, dejá que gelifique y después completás en 2 o 3 coladas más gruesas, así controlás mejor temperatura y burbujas.' },
      { role: 'assistant', content: '¿Las tablas ya las tenés cortadas a medida o tenés que conseguirlas?' },
    ],
  },
  {
    scenario: 'mat-300-presentaciones',
    title: 'MAT 300 — presentaciones sin código interno',
    priority: 140,
    turns: [
      { role: 'user',      content: 'tenés mat 300?' },
      { role: 'assistant', content: 'Sí, hay stock. La fibra MAT 300 la tenemos en dos formatos:' },
      { role: 'assistant', content: 'Por m² suelto a $4.105 el metro — disponible en cortes de 1, 5, 10 y 20 m². https://www.tiendaservifibras.com/productos/fibra-de-vidrio-mat-300/' },
      { role: 'assistant', content: 'O el rollo completo de 45 kg a $199.945. https://www.tiendaservifibras.com/productos/fibra-de-vidrio-mat-300-rollo/' },
      { role: 'assistant', content: '¿Cuánto necesitás más o menos?' },
    ],
  },
  {
    scenario: 'mayorista-derivar',
    title: 'Mayorista — derivar a asesor con info útil',
    priority: 130,
    turns: [
      { role: 'user',      content: 'compro 50 kg de cristal por mes, manejan precio mayorista?' },
      { role: 'assistant', content: 'Recibí tu consulta. Te derivo con un asesor que te arma cotización mayorista a medida — el descuento va variando según volumen y forma de pago.' },
      { role: 'assistant', content: 'Mientras tanto, ¿cuántos kg estás consumiendo por mes hoy y en qué presentación lo estás comprando? Así el asesor llega con la propuesta lista.' },
    ],
  },
];

(async () => {
  const prisma = new PrismaClient();
  try {
    for (const ex of EXAMPLES) {
      const deleted = await prisma.conversationExample.deleteMany({
        where: { scenario: ex.scenario },
      });
      await prisma.conversationExample.create({
        data: {
          scenario: ex.scenario,
          title:    ex.title,
          priority: ex.priority,
          active:   true,
          turns:    ex.turns,
        },
      });
      console.log(`✓ ${ex.scenario.padEnd(36)} (${ex.turns.length} turns) [replaced ${deleted.count}]`);
    }
    const total = await prisma.conversationExample.count({ where: { active: true } });
    console.log(`\nTotal active ConversationExample rows: ${total}`);
  } finally {
    await prisma.$disconnect();
  }
})();
