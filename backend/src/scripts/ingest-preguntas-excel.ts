/**
 * Marcos 2026-07-06 (18:37 ART): "el historial de preguntas cargado
 * también debería haber alimentado respuestas de cada publicación
 * … me refiero al excel que te habia pasado".
 *
 * El Excel `Preguntas_133130075_20260604292.xlsx` es el export de todas
 * las preguntas/respuestas históricas de ML de Marcos (1565 filas).
 * Al momento del pedido de Marcos había estado en /home/overview sin
 * cargarse. Este script lo parsea, dedup contra rows ya ingestadas
 * (via ML API sync) y los inserta con curationStatus='kept' — Marcos
 * las respondió con su tono real, cuentan como memoria válida.
 *
 * Idempotente. Correr con:
 *   DATABASE_URL=... npx ts-node src/scripts/ingest-preguntas-excel.ts <path-to-xlsx>
 *
 * Dedup criteria: (itemId, questionText) — si ya hay una fila para esa
 * publicación y ese texto de pregunta, la actualizamos con la respuesta
 * y el estado del Excel; si no existe, la creamos con mlQuestionId
 * sintético `excel-<idx>` (auditable).
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as crypto from 'crypto';

interface ExcelRow {
  Fecha: string | null;
  Estado: string | null;
  'Nro. de Publicación': string | null;
  'Título de la Publicación': string | null;
  'Nombre del usuario': string | null;
  'Texto de la pregunta': string | null;
  'Texto de la respuesta': string | null;
  'Respondió': string | null;
  'Fecha y hora de respuesta': string | null;
  [k: string]: any;
}

const parseDate = (s: string | null): Date | null => {
  if (!s) return null;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? new Date(t) : null;
};

async function main() {
  const xlsxPath = process.argv[2];
  if (!xlsxPath) {
    console.error('usage: ingest-preguntas-excel.ts <xlsx-path>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  console.log(`reading ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`parsed ${rows.length} rows from sheet "${wb.SheetNames[0]}"`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const [i, r] of rows.entries()) {
    const rawItemId = (r['Nro. de Publicación'] ?? '').toString().trim();
    const questionText = (r['Texto de la pregunta'] ?? '').toString().trim();
    const answerText = (r['Texto de la respuesta'] ?? '').toString().trim();
    if (!rawItemId || !questionText) {
      skipped++;
      continue;
    }
    // itemId in DB carries the MLA prefix (per existing rows).
    const itemId = rawItemId.startsWith('MLA') ? rawItemId : `MLA${rawItemId}`;
    const questionAt = parseDate(r['Fecha']) ?? new Date();
    const answeredAt = parseDate(r['Fecha y hora de respuesta']);
    const estado = (r['Estado'] ?? '').toString().toLowerCase();
    const isAnswered = estado === 'respondida' && answerText.length > 0;

    // Dedup by (itemId, questionText). If a row already exists (via API
    // sync o corrección anterior), la actualizamos preservando el
    // curationStatus si ya es 'edited' — el operador editó ese answer,
    // no queremos pisarlo con el histórico.
    const existing = await prisma.mlPublicationKnowledge.findFirst({
      where: { itemId, questionText },
      select: { id: true, curationStatus: true },
    });

    if (existing) {
      if (existing.curationStatus === 'edited') {
        skipped++;
        continue;
      }
      await prisma.mlPublicationKnowledge.update({
        where: { id: existing.id },
        data: {
          answerText: isAnswered ? answerText : null,
          answeredAt,
          // Marcamos como 'kept' — el histórico son respuestas que el
          // equipo dio realmente en ML, tienen que contar como memoria.
          curationStatus: isAnswered ? 'kept' : existing.curationStatus,
        },
      });
      updated++;
    } else {
      // mlQuestionId sintético — no vino del sync ML, no tiene un id
      // real. Hash del (itemId + questionText) para que sea determinista
      // (re-run del script no genera duplicados).
      const hash = crypto
        .createHash('sha1')
        .update(`${itemId}|${questionText}`)
        .digest('hex')
        .slice(0, 16);
      const syntheticId = `excel-${hash}`;
      // Fallback si (por casualidad astronómica) ya existe ese id.
      const collides = await prisma.mlPublicationKnowledge.findUnique({
        where: { mlQuestionId: syntheticId },
        select: { id: true },
      });
      if (collides) {
        skipped++;
        continue;
      }
      await prisma.mlPublicationKnowledge.create({
        data: {
          itemId,
          accountKey: 'mercadolibre',
          mlQuestionId: syntheticId,
          questionText,
          answerText: isAnswered ? answerText : null,
          questionAt,
          answeredAt,
          curationStatus: isAnswered ? 'kept' : 'pending',
        },
      });
      inserted++;
    }

    if ((i + 1) % 200 === 0) {
      console.log(`  progress: ${i + 1}/${rows.length} (ins=${inserted} upd=${updated} skip=${skipped})`);
    }
  }

  console.log('');
  console.log(`DONE — inserted=${inserted} updated=${updated} skipped=${skipped} total=${rows.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('ingest failed:', err);
  process.exit(1);
});
