/**
 * Database Seed Script
 * Populates knowledge base with Servifibras product information
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Servifibras Knowledge Base...');
  console.log('');

  // Clear existing knowledge base
  await prisma.knowledgeBase.deleteMany({});
  console.log('✓ Cleared existing knowledge base');

  // RESINAS (Resins)
  await prisma.knowledgeBase.createMany({
    data: [
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
- 1 kg
- 5 kg
- 20 litros
- 200 litros (mayorista)

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
- 1 kg (incluye endurecedor)
- 5 kg (incluye endurecedor)
- 20 kg (incluye endurecedor)

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

Presentaciones: bajo pedido para proyectos industriales.`,
        active: true,
      },
    ],
  });
  console.log('✓ Added Resinas knowledge');

  // FIBRA DE VIDRIO (Fiberglass)
  await prisma.knowledgeBase.createMany({
    data: [
      {
        category: 'Fibra de Vidrio',
        subcategory: 'Mat',
        title: 'Mat de Fibra de Vidrio',
        content: `El mat es fibra de vidrio en forma de manta no tejida.

Tipos disponibles:
- Mat 300g/m² (rollo 50m × 1m)
- Mat 450g/m² (rollo 50m × 1m)
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
- Roving 500g/m²
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
    ],
  });
  console.log('✓ Added Fibra de Vidrio knowledge');

  // CAUCHOS DE SILICONA (Silicone Rubbers)
  await prisma.knowledgeBase.createMany({
    data: [
      {
        category: 'Cauchos de Silicona',
        subcategory: null,
        title: 'Silicona para Moldes',
        content: `Cauchos de silicona para fabricación de moldes.

Tipos disponibles:
- Silicona RTV (temperatura ambiente)
- Shore A20 (blanda, flexible)
- Shore A30 (dureza media)
- Shore A40 (dura, detalles finos)

Características:
- Excelente reproducción de detalles
- Resistencia a rasgado
- Durabilidad (cientos de copias)
- No requiere desmoldante en la mayoría de casos
- Relación de mezcla típica: 100:10 (base:catalizador)

Aplicaciones:
- Moldes para resina epoxi
- Moldes para resina poliéster
- Reproducción de piezas
- Arte y artesanía
- Prototipos

Presentaciones:
- 1 kg
- 5 kg
- 25 kg (industrial)

Recomendación: Para piezas grandes usar silicona más blanda (Shore A20-A25). Para detalles finos usar Shore A35-A40.`,
        active: true,
      },
    ],
  });
  console.log('✓ Added Cauchos de Silicona knowledge');

  // INFORMACIÓN GENERAL Y FAQ
  await prisma.knowledgeBase.createMany({
    data: [
      {
        category: 'Información General',
        subcategory: null,
        title: 'Compatibilidad de Productos',
        content: `Información importante sobre mezclas y compatibilidad:

⚠️ NUNCA mezclar:
- Resina epoxi con resina poliéster: NO son compatibles
- Diferentes tipos de resina en la misma pieza: causarán problemas de curado

Compatible:
- Mat de fibra de vidrio con poliéster: SÍ (ideal)
- Mat de fibra de vidrio con epoxi: Verificar (preferir mat sin aglutinante)
- Tela roving con todas las resinas: SÍ

Para abaratar costos:
- NO mezclar diferentes resinas
- SI usar resina poliéster en lugar de epoxi para aplicaciones menos exigentes
- SI usar mat en lugar de tela cuando no se requiera máxima resistencia`,
        active: true,
      },
      {
        category: 'Información General',
        subcategory: null,
        title: 'Seguridad y Manipulación',
        content: `Precauciones de seguridad al trabajar con estos productos:

Equipo de protección personal:
- Guantes de nitrilo (obligatorio)
- Gafas de seguridad
- Mascarilla con filtro para vapores orgánicos
- Ropa que cubra la piel
- Ventilación adecuada

Resinas:
- Trabajar en área ventilada
- No inhalar vapores
- Evitar contacto con piel
- Catalizador MEKP es corrosivo

Fibra de vidrio:
- Usar guantes (causa picazón)
- Mascarilla contra polvo al cortar
- Lavar ropa separada después de usar

Almacenamiento:
- Lugar fresco y seco
- Lejos de fuentes de calor
- Catalizador separado de resinas
- Mantener tapado cuando no se use`,
        active: true,
      },
      {
        category: 'Información General',
        subcategory: null,
        title: 'Tiempos de Entrega y Stock',
        content: `Información sobre disponibilidad y envíos:

Stock habitual:
- Resina poliéster: stock permanente
- Resina epoxi: stock permanente
- Mat 300g y 450g: stock permanente
- Tela roving 500g: stock permanente
- Silicona RTV: stock permanente

Envíos:
- Capital Federal y GBA: 24-48 horas
- Interior del país: 3-5 días hábiles vía Andreani
- Cálculo de costo: ingresar código postal en la publicación de MercadoLibre

Compras mayoristas:
- Descuentos por volumen disponibles
- Atención personalizada con Franco (equipo de ventas)
- Consultar por productos específicos no listados`,
        active: true,
      },
    ],
  });
  console.log('✓ Added Información General');

  const count = await prisma.knowledgeBase.count();
  console.log('');
  console.log(`✅ Knowledge base seeded successfully!`);
  console.log(`   Total items: ${count}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
