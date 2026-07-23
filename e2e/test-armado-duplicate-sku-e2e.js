// Marcos 2026-07-23 (screenshot pack #2000014153154619 OTELIB): un
// pack con 2 items del mismo SKU (mismo SKU en 2 publicaciones ML
// distintas) no llegaba a 4/4 en el armado. Root cause: la lógica
// del reader hacía match "tolerante" — cualquier entrada del set
// con el prefijo `sku:` marcaba TODOS los items con ese sku como
// checked. Al tildar 1 se veían 2 como tildados; el count real en
// backend contaba 1 → 3/4 y bloqueaba el LISTO. Y el uncheck hacía
// delete-by-prefix borrando ambos.
//
// El fix vive en el JSX del route /logistica-diaria (2 pasos de
// consumo del set: exact → tolerante 1-a-1). Este test corre la
// misma función-pura de matching contra fixtures adversariales.

// La función bajo test es la misma lógica que el reader del JSX pero
// exportable para verificarla sin renderizar React. Refleja
// literalmente el algoritmo shipeado.
function detectCheckedIndices(items, checkedArr) {
  const itemKeyFor = (it, idx) => {
    const base = it.sku && it.sku.length > 0 ? it.sku : 'item';
    return `${base}:${idx}`;
  };
  const checkedSet = new Set(checkedArr);
  const checkedIndicesSet = new Set();
  const remaining = new Set(checkedSet);
  items.forEach((it, idx) => {
    const key = itemKeyFor(it, idx);
    if (remaining.has(key)) {
      checkedIndicesSet.add(idx);
      remaining.delete(key);
    }
  });
  items.forEach((it, idx) => {
    if (checkedIndicesSet.has(idx)) return;
    if (!it.sku || it.sku.length === 0) return;
    const prefix = `${it.sku}:`;
    for (const k of remaining) {
      if (k.startsWith(prefix)) {
        checkedIndicesSet.add(idx);
        remaining.delete(k);
        break;
      }
    }
  });
  return checkedIndicesSet;
}

function uncheckSet(items, idx, checkedArr) {
  const itemKeyFor = (it, i) => {
    const base = it.sku && it.sku.length > 0 ? it.sku : 'item';
    return `${base}:${i}`;
  };
  const skuPrefixOf = (k) => {
    const colon = k.indexOf(':');
    if (colon <= 0) return null;
    const prefix = k.substring(0, colon);
    if (prefix === 'item') return null;
    return prefix + ':';
  };
  const set = new Set(checkedArr);
  const itemKey = itemKeyFor(items[idx], idx);
  if (set.has(itemKey)) {
    set.delete(itemKey);
  } else {
    const pref = skuPrefixOf(itemKey);
    if (pref) {
      for (const k of Array.from(set)) {
        if (k.startsWith(pref)) { set.delete(k); break; }
      }
    }
  }
  return Array.from(set);
}

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// Fixture del pack de Marcos: 4 items, dos con SKU 204, uno 205, uno 48.
const otelibItems = [
  { sku: '204', name: 'Pigmento Perlado Multicromatico 204-D' },
  { sku: '204', name: 'Pigmento Perlado Multicromatico 204-D (v2)' },
  { sku: '205', name: 'Pigmento Perlado Multicromatico 205-P' },
  { sku: '48',  name: 'Pigmento Camaleon Duocromatico Para Resina' },
];

// (1) tildar SOLO el primer 204 → sólo idx=0 queda checked (no ambos)
{
  const checked = detectCheckedIndices(otelibItems, ['204:0']);
  ok('single check on 204:0 → only idx 0 marked', checked.size === 1 && checked.has(0), `set=${[...checked].join(',')}`);
}

// (2) tildar 204:0 + 205:2 + 48:3 (los 3 que Marcos había tildado) → count = 3, idx 1 NO checked
{
  const checked = detectCheckedIndices(otelibItems, ['204:0', '205:2', '48:3']);
  ok('3 real checks → count 3 (not 4)', checked.size === 3, `size=${checked.size}`);
  ok('the SECOND SKU 204 (idx=1) stays unchecked', !checked.has(1), `has1=${checked.has(1)}`);
}

// (3) tildar todos correctamente (204:0, 204:1, 205:2, 48:3) → 4/4
{
  const checked = detectCheckedIndices(otelibItems, ['204:0', '204:1', '205:2', '48:3']);
  ok('all 4 tildados correctly → 4/4', checked.size === 4);
}

// (4) drift entre fetches: 204 fue tildado como "204:2" antes, ahora
//     el item vive en idx=0. La tolerancia todavía debería agarrarlo
//     como checked para idx=0. Confirmar que NO se pierde ese chequeo.
{
  const checked = detectCheckedIndices(
    [{ sku: '204', name: 'X' }, { sku: '48', name: 'Y' }],
    ['204:2', '48:1'],
  );
  ok('drift `204:2` still counts as checked when item now at idx=0', checked.has(0));
  ok('drift also matches 48:1 exact', checked.has(1));
}

// (5) el bug histórico simétrico: si hay 1 sola entrada `204:0` en set
//     y 2 items del mismo SKU, la vieja tolerante marcaba AMBOS como
//     checked. Ahora sólo 1 lo debe estar (mecanismo de consumo 1-a-1).
{
  const checked = detectCheckedIndices(otelibItems, ['204:0']);
  ok('only 1 entry `204:0` in set → exactly 1 of the 2 SKU-204 items checked', checked.size === 1);
}

// (6) uncheck del segundo 204 cuando SÓLO tenía la marca via tolerante
{
  // Set = ['204:0']. Item[0] exact-matched. Item[1] tolerante.
  // Uncheck de item[1] → debe borrar UNA entrada del prefijo 204 (la
  // única, `204:0`). El item[0] deja de estar checked pero eso es
  // el precio del uncheck del item que "aparecía" checked vía tolerancia.
  const next = uncheckSet(otelibItems, 1, ['204:0']);
  ok('uncheck of tolerantly-matched item removes exactly ONE 204:* entry', next.filter(k => k.startsWith('204:')).length === 0, `next=${next.join(',')}`);
}

// (7) uncheck del primer 204 con set=[204:0, 204:1] NO borra el segundo
//     (era el bug: prefix-cleanup borraba TODOS los 204:*)
{
  const next = uncheckSet(otelibItems, 0, ['204:0', '204:1', '205:2']);
  ok('uncheck of exact-matched item keeps sibling 204 checked', next.includes('204:1'));
  ok('uncheck removes only exact 204:0', !next.includes('204:0'));
  ok('unaffected 205:2 stays', next.includes('205:2'));
}

// (8) items sin SKU nunca se comparten (exact-only path)
{
  const items = [
    { sku: null, name: 'A' },
    { sku: null, name: 'B' },
    { sku: '10', name: 'C' },
  ];
  const checked = detectCheckedIndices(items, ['item:0', '10:2']);
  ok('no-sku items exact-only: idx 0 checked, idx 1 not', checked.has(0) && !checked.has(1) && checked.has(2));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
