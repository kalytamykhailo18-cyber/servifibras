/**
 * ADAPTERS LAYER — Daily Logística Excel generator.
 *
 * Bloque C — Marcos 2026-06-06. Produces the daily xlsx file that
 * matches the structure of his current manual sheet
 * (`Envios- Ustym (1).xlsx`):
 *
 *   1. Header block: Links favoritos (from Configuration) +
 *      Notas operativas (free text).
 *   2. Placas PRFV in three sub-sections (DESPACHADAS/RETIRADAS,
 *      LISTAS/CORTADAS, PENDIENTES) — same order as Marcos's current
 *      Excel.
 *   3. Daily date marker (Excel-style numeric date stamp).
 *   4. Six fixed sections in order: COLECTA 1, COLECTA 2, FLEX 1,
 *      FLEX 2, MOTOS, MICROS. Inside each, one row per order with
 *      columns (Cliente / Producto / Armado / TimestampArmado).
 *
 * The picker's columns C/D mirror the existing file: column C is a
 * "true"/"false" string (Excel reads the literal — Marcos's current
 * sheet uses the same convention, no formula), column D is an ISO
 * timestamp string when armado=true otherwise blank.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  DailyLogisticaAggregatorService,
  SECTION_LABELS,
  SECTION_ORDER,
  type AggregatedDay,
  type DailySection,
  type DailySectionRow,
} from './daily-logistica-aggregator.service';
import { ConfigurationService } from './configuration.service';
import { PrfvPlacaService } from './prfv-placa.service';
import { PrfvPlacaState } from '@prisma/client';

const PRFV_SECTION_ORDER: PrfvPlacaState[] = [
  PrfvPlacaState.DESPACHADA_RETIRADA,
  PrfvPlacaState.LISTA_CORTADA,
  PrfvPlacaState.PENDIENTE,
];

const PRFV_SECTION_LABELS: Record<PrfvPlacaState, string> = {
  [PrfvPlacaState.DESPACHADA_RETIRADA]: 'PLACAS PRFV DESPACHADAS/RETIRADAS',
  [PrfvPlacaState.LISTA_CORTADA]: 'PLACAS PRFV LISTAS/CORTADAS',
  [PrfvPlacaState.PENDIENTE]: 'PLACAS PRFV PENDIENTES',
};

function isoDayLabel(isoDay: string): string {
  // Convert YYYY-MM-DD to the Excel-day serial Marcos uses as the day
  // separator (e.g. 46181). 1900-01-01 is serial 1 in Excel's epoch.
  const [y, m, d] = isoDay.split('-').map(Number);
  const epoch = Date.UTC(1899, 11, 30); // Excel epoch (with the 1900 leap bug aligned)
  const ts = Date.UTC(y, m - 1, d);
  return String(Math.floor((ts - epoch) / 86400000));
}

@Injectable()
export class DailyLogisticaXlsxService {
  private readonly logger = new Logger(DailyLogisticaXlsxService.name);

  constructor(
    private readonly aggregator: DailyLogisticaAggregatorService,
    private readonly configuration: ConfigurationService,
    private readonly prfv: PrfvPlacaService,
  ) {}

  /**
   * Build the xlsx workbook for the requested day and return it as a
   * Buffer ready to stream to the operator.
   */
  async build(date: Date): Promise<{ buffer: Buffer; filename: string; aggregated: AggregatedDay }> {
    const aggregated = await this.aggregator.aggregate(date);
    const [logistica, placas] = await Promise.all([
      this.configuration.getLogisticaConfiguration(),
      this.prfv.list(),
    ]);

    const rows: any[][] = [];

    // ─── Header: Links favoritos ─────────────────────────────────────
    rows.push(['LINKS FAVORITOS', '', '', '']);
    const links = logistica?.linksFavoritos ?? [];
    if (links.length === 0) {
      rows.push(['(sin links cargados — Configuración → Logística)', '', '', '']);
    } else {
      for (const l of links) rows.push([l.label, l.url, '', '']);
    }
    rows.push(['', '', '', '']);

    // ─── Header: Notas operativas ────────────────────────────────────
    const notas = (logistica?.notasOperativas ?? '').trim();
    if (notas.length > 0) {
      rows.push(['NOTAS OPERATIVAS', '', '', '']);
      for (const line of notas.split('\n')) rows.push([line, '', '', '']);
      rows.push(['', '', '', '']);
    }

    // ─── Header: Placas PRFV (3 sub-sections) ────────────────────────
    for (const state of PRFV_SECTION_ORDER) {
      rows.push([PRFV_SECTION_LABELS[state], '', '', '']);
      const inState = placas.filter((p) => p.state === state);
      if (inState.length === 0) {
        rows.push(['(sin placas)', '', '', '']);
      } else {
        for (const p of inState) {
          rows.push([
            p.cliente,
            p.producto,
            p.notes ?? '',
            this.fmtTimestamp(p.stateChangedAt),
          ]);
        }
      }
      rows.push(['', '', '', '']);
    }

    // ─── Day marker (Excel-day serial like Marcos's current sheet) ───
    rows.push([isoDayLabel(aggregated.date), '', '', '']);

    // ─── 6 fixed sections in order ───────────────────────────────────
    for (const section of SECTION_ORDER) {
      rows.push([SECTION_LABELS[section], '', '', '']);
      const sectionRows = aggregated.sections[section];
      if (sectionRows.length === 0) {
        rows.push(['', '', '', '']);
      } else {
        for (const r of sectionRows) {
          rows.push([
            r.cliente,
            r.producto,
            r.armado ? 'true' : 'false',
            r.armado && r.armadoAt ? this.fmtTimestamp(r.armadoAt) : '',
          ]);
        }
      }
      rows.push(['', '', '', '']);
    }

    // ─── Footer with source notes ────────────────────────────────────
    if (aggregated.notes.length > 0 || aggregated.errors.length > 0) {
      rows.push(['NOTAS DE GENERACIÓN', '', '', '']);
      for (const n of aggregated.notes) rows.push([`[${n.source}]`, n.message, '', '']);
      for (const e of aggregated.errors) rows.push([`[ERROR · ${e.source}]`, e.message, '', '']);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Column widths matching the picker's reading layout — cliente
    // wide, producto wide, armado narrow, timestamp narrow.
    ws['!cols'] = [
      { wch: 48 },
      { wch: 48 },
      { wch: 10 },
      { wch: 22 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'envios');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = this.fmtFilename(aggregated.date);
    this.logger.log(
      `Daily Logística xlsx generated: date=${aggregated.date} rows=${rows.length} bytes=${buffer.length}`,
    );
    return { buffer, filename, aggregated };
  }

  private fmtTimestamp(input: Date | string): string {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return '';
    // Argentina-local dd/mm/yyyy HH:MM — matches Marcos's reading convention.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private fmtFilename(isoDay: string): string {
    // Mirrors the operator's existing pattern: "Envios- YYYY-MM-DD.xlsx".
    return `Envios- ${isoDay}.xlsx`;
  }
}

export type { DailySection, DailySectionRow };
