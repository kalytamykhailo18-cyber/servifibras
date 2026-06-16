/**
 * ADAPTERS LAYER — Quote (presupuesto) PDF builder.
 *
 * Renders a presupuesto PDF that mirrors the paper format Marcos sent:
 *
 *   - Header: company logo + branch info on the left, "Presupuesto"
 *     badge + Nº + fecha on the right.
 *   - Buyer block: Sr./es, Domicilio, IVA, F. de Pago, Cond. de Pago,
 *     Localidad, CUIT, Vencimiento, Plazo de Ent.
 *   - Banner: COTIZACIÓN SUJETA A REAJUSTE POR VARIACIONES CAMBIARIAS.
 *   - Items table with Cant., Detalle, Unitario, Total.
 *   - Totals box on the right (Monto gravado, IVA, Total).
 *   - Footer: branch info / signature line.
 *
 * Company info comes from `.env` so a future branch swap doesn't need a
 * code change. Defaults match the data on Marcos's reference presupuesto.
 */

import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');

export interface QuoteItem {
  quantity: number;
  description: string;
  unitPrice: number;
  total: number;
}

export interface QuotePdfData {
  quoteNumber: string;
  issueDate: Date;
  expirationDate: Date;
  buyerName: string;
  buyerAddress?: string | null;
  buyerLocality?: string | null;
  buyerTaxId?: string | null;
  buyerTaxStatus?: string | null;
  paymentMethod?: string | null;
  paymentTerms?: string | null;
  deliveryTerm?: string | null;
  currency: string;
  items: QuoteItem[];
  netAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string | null;
}

interface CompanyConfig {
  name: string;
  email: string;
  web: string;
  address: string;
  phone: string;
  taxStatus: string;
  cuit: string;
  iibb: string;
  activityStart: string;
  branchFooter: string;
  logoPath: string;
  pageSize: string;
  margin: number;
  taxLabel: string;
  saleTermsBanner: string;
}

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v != null && v.length > 0 ? v : fallback;
}
function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadCompany(): CompanyConfig {
  return {
    name:          envStr('QUOTE_COMPANY_NAME',     'de Servifibras SRL'),
    email:         envStr('QUOTE_COMPANY_EMAIL',    'servifibrasbuenosaires@gmail.com'),
    web:           envStr('QUOTE_COMPANY_WEB',      'www.tiendaservifibras.com'),
    address:       envStr('QUOTE_COMPANY_ADDRESS',  'Martín de Alzaga 3634, Caseros (Buenos Aires)'),
    phone:         envStr('QUOTE_COMPANY_PHONE',    'Tel/Fax: 113588-0083'),
    taxStatus:     envStr('QUOTE_COMPANY_TAX_STATUS', 'Responsable Inscripto'),
    cuit:          envStr('QUOTE_COMPANY_CUIT',     '30-71783251-1'),
    iibb:          envStr('QUOTE_COMPANY_IIBB',     '30717832511'),
    activityStart: envStr('QUOTE_COMPANY_ACTIVITY_START', '01/01/2023'),
    branchFooter:  envStr('QUOTE_COMPANY_FOOTER',   'CAJA ONLINE Y CASEROS'),
    logoPath:      envStr('QUOTE_COMPANY_LOGO_PATH', path.join(process.cwd(), 'assets', 'logo.jpg')),
    pageSize:      envStr('QUOTE_PDF_PAGE_SIZE',     'A4'),
    margin:        envNum('QUOTE_PDF_MARGIN',        36),
    taxLabel:      envStr('QUOTE_TAX_LABEL',         'IVA'),
    saleTermsBanner: envStr('QUOTE_SALE_TERMS_BANNER',
      'COTIZACIÓN SUJETA A REAJUSTE POR VARIACIONES CAMBIARIAS'),
  };
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function fmtMoney(n: number, currency: string = 'ARS'): string {
  // Argentine "$ 12.345,67" — dot for thousands, comma for decimals.
  const sign = currency === 'USD' ? 'USD ' : '$ ';
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withGroups = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${withGroups},${decPart}`;
}

/**
 * Build the PDF and return it as a Buffer. Buffer mode keeps the API
 * easy for both `Res.send(buffer)` and unit-tests that snapshot the byte
 * length / parse the structure.
 */
export function buildQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const company = loadCompany();
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: company.pageSize,
        margin: company.margin,
        info: {
          Title: `Presupuesto ${data.quoteNumber}`,
          Author: company.name,
          Subject: 'Presupuesto / Cotización',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderHeader(doc, company, data);
      renderBuyerBlock(doc, data);
      renderTermsBanner(doc, company);
      renderItemsTable(doc, data);
      renderTotalsBox(doc, company, data);
      renderFooter(doc, company);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ---- Layout helpers ----------------------------------------------

function renderHeader(doc: PDFKit.PDFDocument, c: CompanyConfig, data: QuotePdfData) {
  // Layout (matching Marcos's reference):
  //   ┌─────────────────────────────────────────────────────────┐
  //   │ pad                                                      │
  //   │  ┌───────────┐  ┌───┐  ┌─────────────┐                  │
  //   │  │   LOGO    │  │   │  │ Presupuesto │                  │
  //   │  │ (centred) │  │ X │  │   Nº / Fec  │                  │
  //   │  │ Servifib… │  │ █ │  │   ─ blank ─ │                  │
  //   │  │ Martín…   │  │ █ │  │   C.U.I.T.  │                  │
  //   │  │ Resp Ins  │  │   │  │   IIBB Inic │                  │
  //   │  └───────────┘  └───┘  └─────────────┘                  │
  //   │ pad                                                      │
  //   └─────────────────────────────────────────────────────────┘
  // Logo + company-info live in a single LEFT container, all centered
  // horizontally within it. X is a tall blue column spanning the full
  // header height (with internal padding). Right container holds the
  // Presupuesto + CUIT stacks, padded from the rectangle edge.
  const top = doc.y;
  const pageW = doc.page.width;
  const margin = c.margin;

  const docTypeLabel = envStr('QUOTE_DOC_TYPE_LABEL', 'X');
  const docTypeColor = envStr('QUOTE_DOC_TYPE_COLOR', '#1e88e5');

  const headerH = 130;
  const headerW = pageW - margin * 2;
  const pad = 8;              // internal padding inside the header box
  const xColW = 36;
  const xGap = 8;             // gap between left container and X column
  const rightColW = 140;
  const leftColW = headerW - pad * 2 - xColW - xGap * 2 - rightColW;

  // Outer border
  doc.lineWidth(0.6).strokeColor('#0f172a')
    .rect(margin, top, headerW, headerH).stroke();

  const innerY = top + pad;
  const innerH = headerH - pad * 2;

  // ---- X column — full inner height, blue, white X centered ------
  const xColX = margin + pad + leftColW + xGap;
  doc.rect(xColX, innerY, xColW, innerH).fillAndStroke(docTypeColor, docTypeColor);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34);
  // Vertically center the X within the column
  const xTextY = innerY + (innerH - 34) / 2 + 2;
  doc.text(docTypeLabel, xColX, xTextY, { width: xColW, align: 'center' });
  doc.fillColor('#0f172a').font('Helvetica');

  // ---- Left container: logo on top, company info below; both
  //      horizontally centered within the container ----------------
  const leftX = margin + pad;
  let leftCursorY = innerY + 2;
  try {
    if (fs.existsSync(c.logoPath)) {
      const logoH = 44;
      // pdfkit picks proportional width from height. We can't know the
      // resulting width in advance, but assume the logo is roughly
      // square so we offset by (leftColW - logoH)/2 to center it.
      const logoX = leftX + (leftColW - logoH) / 2;
      doc.image(c.logoPath, logoX, leftCursorY, { height: logoH });
      leftCursorY += logoH + 4;
    }
  } catch { /* skip */ }

  // Company info — three lines, all centered within the left container.
  // 7pt fits the long email/web line at the available leftColW (~285pt).
  doc.fontSize(7).font('Helvetica').fillColor('#0f172a');
  doc.text(`${c.name} | e-mail: ${c.email} | web: ${c.web}`, leftX, leftCursorY, {
    width: leftColW, align: 'center',
  });
  doc.text(`${c.address} - ${c.phone}`, leftX, doc.y + 1, {
    width: leftColW, align: 'center',
  });
  doc.font('Helvetica-Bold')
    .text(c.taxStatus, leftX, doc.y + 1, { width: leftColW, align: 'center' });
  doc.font('Helvetica');

  // ---- Right container: Presupuesto+Nº+Fecha (top), CUIT block (bottom)
  const rightX = pageW - margin - pad;
  const rightTextW = rightColW;
  const rightTextX = rightX - rightTextW;

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f172a')
    .text('Presupuesto', rightTextX, innerY,      { width: rightTextW, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11)
    .text(`Nº ${data.quoteNumber}`,                rightTextX, innerY + 26, { width: rightTextW, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11)
    .text(`Fecha: ${fmtDate(data.issueDate)}`,     rightTextX, innerY + 40, { width: rightTextW, align: 'right' });

  // CUIT subblock anchored to the bottom of the inner area
  const subFontSize = 8;
  const subLineH = 10;
  const subBlockH = subLineH * 3 + 4;
  const subY = innerY + innerH - subBlockH;
  doc.font('Helvetica').fontSize(subFontSize).fillColor('#0f172a')
    .text(`C.U.I.T. ${c.cuit}`,                          rightTextX, subY,                  { width: rightTextW, align: 'right' });
  doc.text(`IIBB ${c.iibb}`,                              rightTextX, subY + subLineH,      { width: rightTextW, align: 'right' });
  doc.text(`Inicio de Actividades: ${c.activityStart}`,    rightTextX, subY + subLineH * 2,  { width: rightTextW, align: 'right' });

  doc.y = top + headerH + 4;
}

function renderBuyerBlock(doc: PDFKit.PDFDocument, data: QuotePdfData) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const blockW = pageW - margin * 2;
  const colW = blockW / 2;
  const top = doc.y;
  const padY = 6;

  const lhs: Array<[string, string | null | undefined]> = [
    ['Sr./es',     data.buyerName],
    ['Domicilio',  data.buyerAddress],
    ['I.V.A.',     data.buyerTaxStatus],
    ['F. de Pago', data.paymentMethod],
    ['Cond. de Pago', data.paymentTerms],
  ];
  const rhs: Array<[string, string | null | undefined]> = [
    ['Localidad',  data.buyerLocality],
    ['CUIT',       data.buyerTaxId],
    ['Vencimiento', fmtDate(data.expirationDate)],
    ['Plazo de Ent.', data.deliveryTerm],
  ];

  doc.fontSize(9).fillColor('#0f172a');
  const labelW = 80;
  const lineH = 13;
  // Measure with the SAME font we'll render (Courier is wider than
  // Helvetica, so Helvetica-measured heights underestimate wrap and
  // the next row's content collides into the previous wrapped value).
  const valueH = (text: string, w: number) => {
    if (!text) return lineH;
    doc.font('Courier');
    const h = doc.heightOfString(text, { width: w }) + 2;
    return Math.max(lineH, h);
  };

  // First pass: measure rows
  const rowCount = Math.max(lhs.length, rhs.length);
  const rowHeights: number[] = [];
  let totalRowsH = 0;
  for (let i = 0; i < rowCount; i++) {
    const [labL, valL] = lhs[i] ?? ['', ''];
    const [labR, valR] = rhs[i] ?? ['', ''];
    const hL = labL ? valueH(valL ?? '', colW - labelW - 10) : 0;
    const hR = labR ? valueH(valR ?? '', colW - labelW - 10) : 0;
    const rowH = Math.max(hL, hR, lineH);
    rowHeights.push(rowH);
    totalRowsH += rowH;
  }

  const blockH = padY * 2 + totalRowsH;

  // Outer border for the block
  doc.lineWidth(0.6).strokeColor('#0f172a')
    .rect(margin, top, blockW, blockH).stroke();

  // Render rows — labels right-aligned (matching reference) within their
  // narrow label gutter, values left-aligned next to them.
  let y = top + padY;
  for (let i = 0; i < rowCount; i++) {
    const [labL, valL] = lhs[i] ?? ['', ''];
    const [labR, valR] = rhs[i] ?? ['', ''];
    const rowH = rowHeights[i];

    if (labL) {
      doc.font('Helvetica-Bold').text(labL, margin + 4, y, {
        width: labelW, align: 'right', lineBreak: false,
      });
      doc.font('Courier').text(valL ?? '', margin + labelW + 10, y, {
        width: colW - labelW - 14,
      });
    }
    if (labR) {
      doc.font('Helvetica-Bold').text(labR, margin + colW + 4, y, {
        width: labelW, align: 'right', lineBreak: false,
      });
      doc.font('Courier').text(valR ?? '', margin + colW + labelW + 10, y, {
        width: colW - labelW - 14,
      });
    }
    y += rowH;
  }

  doc.y = top + blockH;
  doc.font('Helvetica');
}

function renderTermsBanner(doc: PDFKit.PDFDocument, c: CompanyConfig) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const w = pageW - margin * 2;
  const h = 18;
  const y = doc.y;
  // Banner sits flush against the buyer block above and the items
  // table below — single rectangle outline, light fill.
  doc.rect(margin, y, w, h).fillAndStroke('#f1f5f9', '#0f172a');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9)
    .text(c.saleTermsBanner, margin, y + 5, { width: w, align: 'center' });
  doc.y = y + h;
  doc.fillColor('#0f172a').font('Helvetica');
}

function renderItemsTable(doc: PDFKit.PDFDocument, data: QuotePdfData) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const tableW = pageW - margin * 2;

  const colCant = 60, colUnit = 90, colTotal = 90;
  const colDet = tableW - colCant - colUnit - colTotal;
  const headerH = 20;
  const headerBg = envStr('QUOTE_TABLE_HEADER_BG',  '#dbeafe');   // light blue
  const headerFg = envStr('QUOTE_TABLE_HEADER_FG',  '#0f172a');
  const borderC  = '#0f172a';

  const headerY = doc.y;
  // Header background + outline
  doc.rect(margin, headerY, tableW, headerH).fillAndStroke(headerBg, borderC);
  doc.fillColor(headerFg).font('Helvetica-Bold').fontSize(9);
  doc.text('Cant.',    margin + 4,                              headerY + 6, { width: colCant - 8 });
  doc.text('Detalle',  margin + colCant + 4,                    headerY + 6, { width: colDet - 8, align: 'center' });
  doc.text('Unitario', margin + colCant + colDet + 4,           headerY + 6, { width: colUnit - 8, align: 'center' });
  doc.text('Total',    margin + colCant + colDet + colUnit + 4, headerY + 6, { width: colTotal - 8, align: 'center' });
  // Vertical separators in header
  const v1 = margin + colCant;
  const v2 = margin + colCant + colDet;
  const v3 = margin + colCant + colDet + colUnit;
  doc.strokeColor(borderC).lineWidth(0.6);
  doc.moveTo(v1, headerY).lineTo(v1, headerY + headerH).stroke();
  doc.moveTo(v2, headerY).lineTo(v2, headerY + headerH).stroke();
  doc.moveTo(v3, headerY).lineTo(v3, headerY + headerH).stroke();

  doc.fillColor('#0f172a').font('Helvetica');

  // Body rows
  let y = headerY + headerH;
  for (const item of data.items) {
    const desc = item.description ?? '';
    const descHeight = doc.heightOfString(desc, { width: colDet - 8 });
    const rowH = Math.max(18, descHeight + 6);

    doc.fontSize(9);
    doc.text(`${item.quantity},00`,                          margin + 4,                              y + 4, { width: colCant - 8, align: 'right' });
    doc.text(desc,                                           margin + colCant + 4,                    y + 4, { width: colDet - 8 });
    doc.text(fmtMoney(item.unitPrice, data.currency),         margin + colCant + colDet + 4,           y + 4, { width: colUnit - 8, align: 'right' });
    doc.text(fmtMoney(item.total,     data.currency),         margin + colCant + colDet + colUnit + 4, y + 4, { width: colTotal - 8, align: 'right' });

    // Row vertical separators
    doc.strokeColor(borderC).lineWidth(0.6);
    doc.moveTo(margin, y).lineTo(margin, y + rowH).stroke();
    doc.moveTo(v1, y).lineTo(v1, y + rowH).stroke();
    doc.moveTo(v2, y).lineTo(v2, y + rowH).stroke();
    doc.moveTo(v3, y).lineTo(v3, y + rowH).stroke();
    doc.moveTo(margin + tableW, y).lineTo(margin + tableW, y + rowH).stroke();
    // Bottom border for the row
    doc.moveTo(margin, y + rowH).lineTo(margin + tableW, y + rowH).stroke();

    y += rowH;
  }
  doc.y = y;
}

function renderTotalsBox(doc: PDFKit.PDFDocument, c: CompanyConfig, data: QuotePdfData) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const tableW = pageW - margin * 2;
  // Match the right-side column widths of the items table so totals sit
  // flush under "Unitario" + "Total".
  const colUnit = 90, colTotal = 90;
  const labelX = pageW - margin - colUnit - colTotal;
  const valueX = pageW - margin - colTotal;
  const rowH = 18;
  const borderC = '#0f172a';
  let y = doc.y;

  const drawRow = (label: string, value: string, opts?: { bold?: boolean; bgFill?: string }) => {
    if (opts?.bgFill) {
      doc.rect(labelX, y, colUnit + colTotal, rowH).fillAndStroke(opts.bgFill, borderC);
    } else {
      doc.lineWidth(0.6).strokeColor(borderC)
        .rect(labelX, y, colUnit + colTotal, rowH).stroke();
    }
    // Vertical separator between label/value
    doc.moveTo(valueX, y).lineTo(valueX, y + rowH).stroke();
    doc.fillColor('#0f172a').fontSize(10);
    if (opts?.bold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
    doc.text(label, labelX + 4, y + 5, { width: colUnit - 8, align: 'right' });
    doc.text(value, valueX + 4, y + 5, { width: colTotal - 8, align: 'right' });
    y += rowH;
  };

  drawRow('Monto gravado', fmtMoney(data.netAmount, data.currency));
  drawRow(`${c.taxLabel} ${(data.taxRate * 100).toFixed(0)},00 %`, fmtMoney(data.taxAmount, data.currency));
  drawRow('Total:', fmtMoney(data.totalAmount, data.currency), { bold: true });

  doc.y = y + 4;
  doc.font('Helvetica');
  if (data.notes) {
    doc.fontSize(8).fillColor('#475569').text(data.notes, doc.page.margins.left, doc.y, {
      width: tableW,
    });
    doc.fillColor('#0f172a');
  }
}

function renderFooter(doc: PDFKit.PDFDocument, c: CompanyConfig) {
  // Marcos's reference: short horizontal line in the body area, with
  // "CAJA ONLINE Y CASEROS" right-aligned beneath it. Bottom of page
  // has page number "1 / 1" right-aligned and a fine-print divider.
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = doc.page.margins.left;

  // Body signature line
  doc.y += 30;
  const sigY = doc.y;
  const sigLineW = 200;
  const sigLineX = pageW - margin - sigLineW;
  doc.strokeColor('#0f172a').lineWidth(0.6);
  doc.moveTo(sigLineX, sigY).lineTo(sigLineX + sigLineW, sigY).stroke();
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
    .text(c.branchFooter, sigLineX, sigY + 4, {
      width: sigLineW, align: 'center',
    });
  doc.font('Helvetica');

  // Page-number footer
  const footY = pageH - margin - 12;
  doc.strokeColor('#cbd5e1').lineWidth(0.4);
  doc.moveTo(margin, footY).lineTo(pageW - margin, footY).stroke();
  doc.fontSize(8).fillColor('#475569')
    .text('1 / 1', margin, footY + 2, {
      width: pageW - margin * 2, align: 'right',
    });
  doc.fillColor('#0f172a');
}
