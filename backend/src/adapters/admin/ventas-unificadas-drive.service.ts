/**
 * ADAPTERS LAYER — Bloque B (signed Phase 2): export the unified-sales
 * snapshot directly into Google Drive instead of the CSV download
 * Marcos rejected on 2026-06-05. Service account auth, xlsx payload,
 * upload + share link returned to the caller.
 *
 * Auth model:
 *   - Service account JSON key. Marcos shares the destination Drive
 *     folder with the service account email; Drive permissions take
 *     it from there — no per-user OAuth dance, no token-refresh cron.
 *   - Either GOOGLE_SERVICE_ACCOUNT_JSON points at a key file on disk
 *     OR it carries the inlined JSON (single line). The service
 *     detects which one it got.
 *
 * Mock mode:
 *   - GOOGLE_DRIVE_MOCK=true short-circuits the Drive call and returns
 *     a stub URL. Lets the Playwright e2e exercise the full data flow
 *     (controller + xlsx generation + button click) without needing
 *     live Google credentials in CI / dev environments.
 */

import * as fs from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import {
  VentasRange,
  VentasRangePayload,
  VentasUnificadasService,
} from './ventas-unificadas.service';

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  /** Mocked uploads carry this so callers can tell prod from test. */
  mocked: boolean;
}

@Injectable()
export class VentasUnificadasDriveService {
  private readonly logger = new Logger(VentasUnificadasDriveService.name);

  constructor(private readonly ventas: VentasUnificadasService) {}

  /**
   * Build the xlsx + push it to Drive. Returns the share link the UI
   * shows the operator.
   */
  async uploadSnapshot(range: VentasRange): Promise<DriveUploadResult> {
    const payload = await this.ventas.get(range);
    const { buffer, fileName } = this.buildXlsx(range, payload);

    const mock = (process.env.GOOGLE_DRIVE_MOCK ?? 'false').toLowerCase() === 'true';
    if (mock) {
      const stub = `https://drive.google.com/file/d/mock-${Date.now()}/view`;
      this.logger.warn(`Drive upload MOCKED (${buffer.length} bytes) → ${stub}`);
      return { fileId: `mock-${Date.now()}`, fileName, webViewLink: stub, mocked: true };
    }

    const folderId = (process.env.GOOGLE_DRIVE_VENTAS_FOLDER_ID ?? '').trim();
    const credsRaw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim();
    if (!folderId || !credsRaw) {
      throw new Error(
        'Drive integration not configured: set GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_DRIVE_VENTAS_FOLDER_ID',
      );
    }

    const creds = this.loadCreds(credsRaw);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });

    const { Readable } = await import('stream');
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      media: {
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: Readable.from(buffer),
      },
      fields: 'id, name, webViewLink',
    });
    if (!res.data?.id || !res.data?.webViewLink) {
      throw new Error('Drive upload returned no id / webViewLink');
    }
    this.logger.log(`Drive upload OK: ${res.data.name} (${res.data.id})`);
    return {
      fileId: res.data.id,
      fileName: res.data.name ?? fileName,
      webViewLink: res.data.webViewLink,
      mocked: false,
    };
  }

  /**
   * Render the unified-sales payload into a 3-sheet xlsx:
   *   - "Resumen": per-source totals + counts + currency split
   *   - "Diario": per-day totals across sources (drives Marcos's trend chart)
   *   - "Notas": footer notes the API surfaced (e.g. cuenta 2 not connected)
   * Marcos's existing xlsx (envios-Ustym.xlsx) uses this same plain-table
   * style — no merges, no formulas — so it opens cleanly in both Excel
   * and Google Sheets without surprises.
   */
  private buildXlsx(
    range: VentasRange,
    p: VentasRangePayload,
  ): { buffer: Buffer; fileName: string } {
    const wb = XLSX.utils.book_new();

    // --- Resumen ---
    const resumenRows: any[][] = [
      ['Servifibras — Ventas unificadas'],
      [`Rango: ${range}`, `Desde: ${p.fromIso}`, `Hasta: ${p.toIso}`],
      [],
      ['Fuente', 'Cantidad de ventas', 'Total (ARS-eq)', 'Moneda', 'Cuenta por moneda', 'Monto por moneda'],
    ];
    for (const s of p.sources) {
      const byCurrency = s.byCurrency ?? [];
      if (byCurrency.length === 0) {
        resumenRows.push([s.label, s.count, s.totalArsLike ?? '', '', '', '']);
        continue;
      }
      for (let i = 0; i < byCurrency.length; i++) {
        const c = byCurrency[i];
        resumenRows.push([
          i === 0 ? s.label : '',
          i === 0 ? s.count : '',
          i === 0 ? (s.totalArsLike ?? '') : '',
          c.currency,
          c.count,
          c.amount,
        ]);
      }
    }
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    // --- Diario ---
    const sourceKeys = p.sources.map((s) => s.source);
    const diarioHeader = ['Fecha', ...sourceKeys, 'Total'];
    const diarioRows: any[][] = [diarioHeader];
    for (const d of p.daily) {
      const cells = sourceKeys.map((k) => d.sources?.[k] ?? 0);
      const total = cells.reduce((acc, x) => acc + (typeof x === 'number' ? x : 0), 0);
      diarioRows.push([d.date, ...cells, total]);
    }
    const wsDiario = XLSX.utils.aoa_to_sheet(diarioRows);
    XLSX.utils.book_append_sheet(wb, wsDiario, 'Diario');

    // --- Notas ---
    const notasRows: any[][] = [
      ['Notas del sistema'],
      [],
      ...(p.notes ?? []).map((n) => [n]),
    ];
    const wsNotas = XLSX.utils.aoa_to_sheet(notasRows);
    XLSX.utils.book_append_sheet(wb, wsNotas, 'Notas');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `servifibras_ventas_${range}_${ts}.xlsx`;
    return { buffer, fileName };
  }

  /**
   * Accept either:
   *   - a path to a JSON key file on disk
   *   - the JSON itself (inlined on one line)
   * and return the parsed credentials object googleapis expects.
   */
  private loadCreds(raw: string): Record<string, unknown> {
    if (raw.startsWith('{')) {
      try {
        return JSON.parse(raw);
      } catch (err: any) {
        throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON parse failed: ${err.message}`);
      }
    }
    if (!fs.existsSync(raw)) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON file not found at ${raw}`);
    }
    try {
      return JSON.parse(fs.readFileSync(raw, 'utf8'));
    } catch (err: any) {
      throw new Error(`Service-account key file unreadable: ${err.message}`);
    }
  }
}
