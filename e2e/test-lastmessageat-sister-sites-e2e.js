// Sister-bug regression — every prisma.message.create in the backend
// must be followed by a conversation.update that carries lastMessageAt.
//
// Yesterday's saveMessage fix (conversation-handler.service.ts) covered
// the central inbound path; a grep found 5 additional call sites that
// insert Message rows directly and would leave lastMessageAt stale,
// breaking the inbox sort Marcos flagged. This test enforces the
// invariant statically: if a new code path inserts a Message row
// without bumping lastMessageAt, it fails here before it ships.
//
// The check is deliberately source-scanning rather than runtime — the
// call sites live behind ML/WhatsApp adapters that need real live
// channels to exercise end-to-end, and the failure mode we care about
// (forgotten lastMessageAt on a fresh code path) is exactly what a
// static scan catches.

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = '/home/servifibras/backend/src';
const WINDOW_LINES = 40;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(p, out);
    } else if (entry.isFile() && p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

function findCreateSites(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    // Match .message.create(  or .message.createMany(  on any prisma-like handle
    if (/\.message\.create(Many)?\s*\(/.test(lines[i])) {
      hits.push({ file, line: i + 1, text: lines[i].trim() });
    }
  }
  return hits;
}

function hasLastMessageAtNearby(file, line) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const start = line - 1;
  const end = Math.min(lines.length, line + WINDOW_LINES);
  const window = lines.slice(start, end).join('\n');
  if (!/\.conversation\.update\s*\(/.test(window)) return false;
  if (!/lastMessageAt\s*:/.test(window)) return false;
  return true;
}

(async () => {
  const files = walk(BACKEND_SRC);
  const sites = files.flatMap(findCreateSites);

  console.log(`\n== lastMessageAt sister-site scan ==`);
  console.log(`  Found ${sites.length} prisma.message.create sites in ${files.length} .ts files`);

  // saveMessage in conversation-handler.service.ts IS the central path
  // — every other call site needs its own lastMessageAt bump. We assert
  // on ALL sites uniformly; saveMessage itself carries the bump too so
  // it passes without a special-case allowlist.
  for (const site of sites) {
    const rel = path.relative(BACKEND_SRC, site.file);
    const ok = hasLastMessageAtNearby(site.file, site.line);
    check(`${rel}:${site.line} bumps lastMessageAt within ${WINDOW_LINES} lines`, ok);
  }

  // Sanity — the 5 known sister sites plus saveMessage should be exactly
  // 6 hits today. If this count changes, a new writer was added and the
  // author should confirm the new path is covered by the check above.
  check(`Site count matches known writers (>= 6)`, sites.length >= 6, `got ${sites.length}`);

  console.log(`\n== ${pass} passed, ${fail} failed ==\n`);
  process.exit(fail ? 1 : 0);
})();
