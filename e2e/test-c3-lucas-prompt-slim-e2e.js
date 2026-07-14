// C3 (documento de trabajo 2026-07-10): "Aliviar el instructivo de
// 33 KB. Reemplazar los casos acumulados por dos o tres buenos ejemplos
// que generalicen, y recortar el prompt."
//
// Criterio de aceptación del documento:
//   "Prompt sustancialmente más corto (objetivo < 10 KB) con calidad
//    igual o mejor en la batería de pruebas."
//
// Este test valida la parte medible: tamaño. La parte "calidad igual
// o mejor" la cubre el conjunto B1 + B2 + B3 (correcciones por
// relevancia + historial por publicación + curadas por significado)
// que absorben lo que antes eran casos acumulados en el prompt.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  const fs = require('fs');

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Read the current active prompt via the file the backend reads.
  // LUCAS_PROMPT_PATH lives in backend/.env.
  const envText = fs.readFileSync('/home/servifibras/backend/.env', 'utf-8');
  const pathMatch = envText.match(/^LUCAS_PROMPT_PATH=(.+)$/m);
  ok('LUCAS_PROMPT_PATH configured', !!pathMatch);

  const promptPath = pathMatch[1].trim();
  ok('prompt file exists', fs.existsSync(promptPath), promptPath);

  const promptText = fs.readFileSync(promptPath, 'utf-8');
  const bytes = Buffer.byteLength(promptText, 'utf-8');
  const kb = (bytes / 1024).toFixed(2);
  ok(`prompt < 10 KB (target from C3)`, bytes < 10 * 1024, `${bytes} B = ${kb} KB`);

  // Sustancialmente más corto vs v5 (39 KB origen).
  const v5Path = '/home/overview/Lucas_Prompt_ServiFibras_v5.txt';
  if (fs.existsSync(v5Path)) {
    const v5Bytes = Buffer.byteLength(fs.readFileSync(v5Path, 'utf-8'), 'utf-8');
    const reduction = 100 - (bytes * 100) / v5Bytes;
    ok(
      `reduction from v5 (${(v5Bytes/1024).toFixed(1)} KB) is > 50%`,
      reduction > 50,
      `${reduction.toFixed(1)}% reduction`,
    );
  }

  // Basic content sanity — ID + prohibited-quotes rule preserved from v5.
  ok('prompt still names "Lucas"', /Lucas/.test(promptText));
  ok('prompt still forbids "¡Claro!"/"¡Perfecto!"', /¡Claro!/.test(promptText));
  ok('prompt still contains PRFV pricing', /USD\/m/.test(promptText));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
