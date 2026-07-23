// Marcos 2026-07-23: TN manda "Servifibras" a secas como carrier
// cuando el comprador elige el envío express propio del local. Esos
// despachos los hace JyJ, se cobran/pagan como JyJ. Antes esta
// cadena caía al fallback title-case y aparecía como bucket
// "Servifibras" (22 packs visibles en el screenshot de Marcos).
// Ahora normaliza a "JyJ". Cubro que no se rompan los buckets
// adyacentes ni las mayúsculas raras.

const { normaliseCarrier } = require('/home/servifibras/backend/dist/src/adapters/admin/carrier-normalize.util');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// (1) La regla nueva: "Servifibras" solo → JyJ
ok('exact "Servifibras" → JyJ', normaliseCarrier('Servifibras') === 'JyJ');
ok('mayúsculas "SERVIFIBRAS" → JyJ', normaliseCarrier('SERVIFIBRAS') === 'JyJ');
ok('con espacio "  servifibras  " → JyJ', normaliseCarrier('  servifibras  ') === 'JyJ');

// (2) NO pisar "Servifibras propio" (branch prfv del aggregator)
ok('"Servifibras propio" sigue en su bucket', normaliseCarrier('Servifibras propio') === 'Servifibras propio');
ok('mayúsculas "SERVIFIBRAS PROPIO" también', normaliseCarrier('SERVIFIBRAS PROPIO') === 'Servifibras propio');

// (3) NO pisar "Retiras en Servifibras Caseros" (pickup TN)
ok('pickup "Retiras en Servifibras Caseros" → Retira Caseros', normaliseCarrier('Retiras en Servifibras Caseros') === 'Retira Caseros');
ok('pickup con "la" → Retira Caseros', normaliseCarrier('Retira en la Servifibras Caseros') === 'Retira Caseros');

// (4) Buckets adyacentes intactos
ok('Andreani intact', normaliseCarrier('Andreani') === 'Andreani');
ok('JyJ raw intact', normaliseCarrier('JyJ') === 'JyJ');
ok('JYJ mayúsculas intact', normaliseCarrier('JYJ') === 'JyJ');
ok('Flex_373 → JyJ (regla vieja)', normaliseCarrier('Flex_373') === 'JyJ');

// (5) Descriptores TN siguen cayendo a Sin asignar
ok('CABA GRATUITO → Sin asignar', normaliseCarrier('CABA GRATUITO (15hs a 21hs)') === 'Sin asignar');
ok('GBA 1 GRATIS → Sin asignar', normaliseCarrier('GBA 1 GRATIS (15hs a 21hs)') === 'Sin asignar');

// (6) Variantes hipotéticas con prefijo — siguen sin matchear la nueva
//     regla (exact match), title-case fallback
ok('"ENVIO EXPRESS SERVIFIBRAS" NO auto-matchea (exacto)', normaliseCarrier('ENVIO EXPRESS SERVIFIBRAS') !== 'JyJ');
ok('empty → Sin asignar', normaliseCarrier('') === 'Sin asignar');
ok('null → Sin asignar', normaliseCarrier(null) === 'Sin asignar');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
