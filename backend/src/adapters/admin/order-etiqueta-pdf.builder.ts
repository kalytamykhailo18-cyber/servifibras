/**
 * Zebra 10×15 cm shipping-label PDF — Marcos 2026-06-16.
 *
 * Matches the etiqueta format the warehouse already prints on Zebra
 * thermal printers (100 mm × 150 mm). Layout: company header block at
 * the top, then Nombre / Dirección / Localidad / TEL / BULTOS rows
 * stacked underneath. One label per page.
 *
 * Page size: 10 cm × 15 cm = 283.46 × 425.20 PostScript points (72 dpi).
 * Margins kept tight (8 pt) — Zebra printers ignore non-printable
 * margins anyway and the operator wants every mm of label area.
 */

import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');

export interface EtiquetaPdfData {
  nombre: string;
  direccion: string | null;
  localidad: string | null;
  telefono: string | null;
  /** Total number of bultos for this order. When >1 the builder
   *  emits one page per bulto with "BULTO 1/N", "BULTO 2/N", etc. */
  bultos: number;
  /**
   * Marcos 2026-06-23: cuando este flag viene true (REPOSICION con
   * devolución), la etiqueta estampa una banda destacada arriba
   * indicando al courier que ADEMÁS de entregar el paquete tiene
   * que RETIRAR otro. Sin esto el courier suele entregar y se va
   * sin retirar nada, dejando el ciclo de devolución roto.
   */
  retirarPaquete?: boolean;
  /** Etiqueta libre del producto a retirar — para que el courier
   *  identifique qué está retirando ("Resina 4L de Pintura Cristal",
   *  etc). Opcional; cuando es null se imprime sólo el aviso genérico. */
  retirarLabel?: string | null;
}

interface CompanyConfig {
  name: string;
  cuit: string;
  web: string;
  logoPath: string;
}

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v != null && v.length > 0 ? v : fallback;
}

function loadCompany(): CompanyConfig {
  return {
    name:     envStr('QUOTE_COMPANY_NAME',     'SERVIFIBRAS SRL'),
    cuit:     envStr('QUOTE_COMPANY_IIBB',     '30717832511'),
    web:      envStr('QUOTE_COMPANY_WEB',      'tiendaservifibras.com'),
    logoPath: envStr('QUOTE_COMPANY_LOGO_PATH', path.join(process.cwd(), 'assets', 'logo.jpg')),
  };
}

const MM_TO_PT = 72 / 25.4;
const PAGE_WIDTH = 100 * MM_TO_PT;   // 283.46 pt
const PAGE_HEIGHT = 150 * MM_TO_PT;  // 425.20 pt
const MARGIN = 8;

export function buildEtiquetaPdf(data: EtiquetaPdfData): Promise<Buffer> {
  const company = loadCompany();
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [PAGE_WIDTH, PAGE_HEIGHT],
        margin: MARGIN,
        info: {
          Title: `Etiqueta — ${data.nombre}`,
          Author: company.name,
          Subject: 'Etiqueta de envío',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Marcos 2026-06-17: emit one page per bulto so the warehouse
      // can stick one label on each box (BULTO 1/N, 2/N, …, N/N).
      const total = Math.max(1, Math.min(50, Math.floor(data.bultos || 1)));
      for (let i = 1; i <= total; i++) {
        if (i > 1) doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: MARGIN });
        renderHeader(doc, company);
        // Marcos 2026-06-23: banda "RETIRAR PAQUETE" cuando el pedido
        // es REPOSICION con devolución — el courier tiene que llevarse
        // un paquete además de entregar.
        if (data.retirarPaquete) renderRetirarBanner(doc, data.retirarLabel ?? null);
        renderRows(doc, { ...data, bultos: total }, i);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderHeader(doc: PDFKit.PDFDocument, c: CompanyConfig) {
  const left = MARGIN;
  const top = MARGIN;
  const innerW = PAGE_WIDTH - 2 * MARGIN;
  const headerH = 100;

  // Outer rectangle around the header block
  doc.lineWidth(0.5).strokeColor('#000000').rect(left, top, innerW, headerH).stroke();
  // Vertical divider — logo cell on the left, text block on the right
  const logoCellW = 90;
  doc.moveTo(left + logoCellW, top).lineTo(left + logoCellW, top + headerH).stroke();

  // Logo
  try {
    if (c.logoPath && fs.existsSync(c.logoPath)) {
      doc.image(c.logoPath, left + 8, top + 8, { fit: [logoCellW - 16, headerH - 16] });
    }
  } catch { /* logo missing — leave the cell blank */ }

  // Right text block
  const textX = left + logoCellW + 8;
  const textW = innerW - logoCellW - 16;
  let y = top + 6;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
    .text(c.name, textX, y, { width: textW });
  y = doc.y;
  doc.font('Helvetica').fontSize(9)
    .text(c.cuit, textX, y, { width: textW })
    .text(c.web, textX, doc.y, { width: textW });
  y = doc.y + 2;
  doc.font('Helvetica-Bold').fontSize(7.5)
    .text(
      'En el caso de no poder entregar por cuestiones de fuerza mayor, por favor CONTÁCTESE con el cliente para reprogramar.',
      textX, y,
      { width: textW, lineGap: 0.5 },
    );
  doc.y = top + headerH + 6;
}

/**
 * Marcos 2026-06-23: banda destacada arriba del bloque de filas.
 * Fondo amarillo fuerte + texto negro grande para que el courier no
 * pueda no verlo. Mide ~50pt de alto; las filas debajo bajan
 * automáticamente porque renderRows arranca desde doc.y.
 */
function renderRetirarBanner(doc: PDFKit.PDFDocument, productLabel: string | null) {
  const left = MARGIN;
  const innerW = PAGE_WIDTH - 2 * MARGIN;
  const y = doc.y;
  const bannerH = productLabel ? 48 : 36;
  doc.save();
  doc.rect(left, y, innerW, bannerH).fill('#FFEB3B');
  doc.restore();
  doc.lineWidth(1.5).strokeColor('#000000').rect(left, y, innerW, bannerH).stroke();
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000')
    .text('⚠ RETIRAR PAQUETE EN EL DOMICILIO', left + 6, y + 4, {
      width: innerW - 12,
      align: 'center',
    });
  doc.font('Helvetica').fontSize(9).fillColor('#000000')
    .text('Entregar + Retirar — no irse sin el paquete a devolver',
      left + 6, y + 22, { width: innerW - 12, align: 'center' });
  if (productLabel) {
    doc.font('Helvetica-Bold').fontSize(9)
      .text(`Retirar: ${productLabel}`, left + 6, y + 34, {
        width: innerW - 12, align: 'center', ellipsis: true,
      });
  }
  doc.y = y + bannerH + 6;
}

function renderRows(doc: PDFKit.PDFDocument, data: EtiquetaPdfData, currentBulto: number = 1) {
  const left = MARGIN;
  const innerW = PAGE_WIDTH - 2 * MARGIN;
  const labelW = 80;
  const valueX = left + labelW;
  const valueW = innerW - labelW;
  const rowH = 42;

  const total = Math.max(1, data.bultos || 1);
  const bultosValue = total === 1 ? '1' : `${currentBulto} / ${total}`;
  const rows: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: 'Nombre',    value: data.nombre || '' },
    { label: 'Dirección', value: data.direccion || '' },
    { label: 'Localidad', value: data.localidad || '' },
    { label: 'TEL',       value: data.telefono || '' },
    { label: 'BULTOS',    value: bultosValue, highlight: true },
  ];

  let y = doc.y;
  for (const row of rows) {
    // Yellow highlight on the label cell for BULTOS
    if (row.highlight) {
      doc.save();
      doc.rect(left, y, labelW, rowH).fill('#FFF59D');
      doc.restore();
    }
    doc.lineWidth(0.5).strokeColor('#000000').rect(left, y, labelW, rowH).stroke();
    doc.rect(valueX, y, valueW, rowH).stroke();

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
      .text(row.label, left + 6, y + (rowH - 12) / 2, { width: labelW - 12 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000')
      .text(row.value, valueX + 6, y + 6, { width: valueW - 12, height: rowH - 12, ellipsis: false });

    y += rowH;
  }
  doc.y = y;
}
