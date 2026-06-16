/**
 * Order (Pedido) PDF builder — Marcos 2026-06-15.
 *
 * Mirrors quote-pdf.builder.ts but for orders: same letterhead, same
 * money + date formatters, same totals box shape. The differences
 * are (1) the title block says "Pedido N°" instead of "Presupuesto",
 * and (2) it carries a "Envío" section with shipping address +
 * locality + postal code + carrier so the picker has the full delivery
 * info in one printable page. Built off the same pdfkit primitives;
 * the company config is read from QUOTE_COMPANY_* env vars so the
 * letterhead stays consistent across both documents.
 */

import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');

export interface OrderPdfItem {
  quantity: number;
  description: string;
  unitPrice: number;
  total: number;
}

export interface OrderPdfShipping {
  address?: string | null;
  streetNumber?: string | null;
  locality?: string | null;
  postalCode?: string | null;
  zone?: string | null;        // province (TN's shipping_address.province)
  carrier?: string | null;     // mensajería
  cost?: number | null;        // shipping_cost_owner
}

export interface OrderPdfData {
  orderNumber: string;
  issueDate: Date;
  buyerName: string;
  buyerPhone?: string | null;
  buyerEmail?: string | null;
  buyerTaxId?: string | null;
  currency: string;
  items: OrderPdfItem[];
  totalAmount: number;
  shipping?: OrderPdfShipping | null;
  notes?: string | null;
  sectionLabel?: string | null;
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
  logoPath: string;
  pageSize: string;
  margin: number;
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
    name:      envStr('QUOTE_COMPANY_NAME',     'de Servifibras SRL'),
    email:     envStr('QUOTE_COMPANY_EMAIL',    'servifibrasbuenosaires@gmail.com'),
    web:       envStr('QUOTE_COMPANY_WEB',      'www.tiendaservifibras.com'),
    address:   envStr('QUOTE_COMPANY_ADDRESS',  'Martín de Alzaga 3634, Caseros (Buenos Aires)'),
    phone:     envStr('QUOTE_COMPANY_PHONE',    'Tel/Fax: 113588-0083'),
    taxStatus: envStr('QUOTE_COMPANY_TAX_STATUS', 'Responsable Inscripto'),
    cuit:      envStr('QUOTE_COMPANY_CUIT',     '30-71783251-1'),
    iibb:      envStr('QUOTE_COMPANY_IIBB',     '30717832511'),
    logoPath:  envStr('QUOTE_COMPANY_LOGO_PATH', path.join(process.cwd(), 'assets', 'logo.jpg')),
    pageSize:  envStr('QUOTE_PDF_PAGE_SIZE',     'A4'),
    margin:    envNum('QUOTE_PDF_MARGIN',        36),
  };
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function fmtMoney(n: number, currency: string = 'ARS'): string {
  const sign = currency === 'USD' ? 'USD ' : '$ ';
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withGroups = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${withGroups},${decPart}`;
}

export function buildOrderPdf(data: OrderPdfData): Promise<Buffer> {
  const company = loadCompany();
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: company.pageSize,
        margin: company.margin,
        info: {
          Title: `Pedido ${data.orderNumber}`,
          Author: company.name,
          Subject: 'Pedido / Orden de venta',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderHeader(doc, company, data);
      renderBuyerBlock(doc, data);
      if (data.shipping) renderShippingBlock(doc, data);
      renderItemsTable(doc, data);
      renderTotalsBox(doc, data);
      if (data.notes) renderNotesBlock(doc, data);
      renderFooter(doc, company);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderHeader(doc: PDFKit.PDFDocument, c: CompanyConfig, data: OrderPdfData) {
  const top = doc.y;
  try {
    if (c.logoPath && fs.existsSync(c.logoPath)) {
      doc.image(c.logoPath, doc.page.margins.left, top, { fit: [80, 80] });
    }
  } catch {/* logo missing → render text-only header */}

  doc.fontSize(16).fillColor('#0f172a').font('Helvetica-Bold')
    .text(c.name, doc.page.margins.left + 92, top, { width: 320 });
  doc.fontSize(9).fillColor('#475569').font('Helvetica')
    .text(c.address, { width: 320 })
    .text(`${c.email} · ${c.web}`, { width: 320 })
    .text(c.phone, { width: 320 })
    .text(`${c.taxStatus} · CUIT ${c.cuit} · IIBB ${c.iibb}`, { width: 320 });

  const rightX = doc.page.width - doc.page.margins.right - 200;
  doc.fontSize(18).fillColor('#1d4ed8').font('Helvetica-Bold')
    .text('PEDIDO', rightX, top, { width: 200, align: 'right' });
  doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold')
    .text(`N° ${data.orderNumber}`, rightX, top + 22, { width: 200, align: 'right' });
  doc.fontSize(9).fillColor('#475569').font('Helvetica')
    .text(`Fecha: ${fmtDate(data.issueDate)}`, rightX, top + 38, { width: 200, align: 'right' });
  if (data.sectionLabel) {
    doc.text(`Envío a: ${data.sectionLabel}`, rightX, top + 52, { width: 200, align: 'right' });
  }

  doc.moveTo(doc.page.margins.left, top + 90)
    .lineTo(doc.page.width - doc.page.margins.right, top + 90)
    .strokeColor('#cbd5e1').lineWidth(0.5).stroke();
  doc.y = top + 100;
}

function renderBuyerBlock(doc: PDFKit.PDFDocument, data: OrderPdfData) {
  const top = doc.y;
  doc.fontSize(10).fillColor('#475569').font('Helvetica-Bold').text('CLIENTE', doc.page.margins.left, top);
  doc.fontSize(10).fillColor('#0f172a').font('Helvetica');
  doc.text(data.buyerName, doc.page.margins.left, top + 14);
  const lines: string[] = [];
  if (data.buyerPhone) lines.push(`Tel: ${data.buyerPhone}`);
  if (data.buyerEmail) lines.push(`Email: ${data.buyerEmail}`);
  if (data.buyerTaxId) lines.push(`CUIT/DNI: ${data.buyerTaxId}`);
  if (lines.length > 0) doc.fontSize(9).fillColor('#475569').text(lines.join('  ·  '), { width: 480 });
  doc.moveDown(0.8);
}

function renderShippingBlock(doc: PDFKit.PDFDocument, data: OrderPdfData) {
  const s = data.shipping!;
  const top = doc.y;
  doc.fontSize(10).fillColor('#475569').font('Helvetica-Bold').text('ENVÍO', doc.page.margins.left, top);
  doc.fontSize(10).fillColor('#0f172a').font('Helvetica');
  const street = [s.address, s.streetNumber].filter(Boolean).join(' ').trim();
  const tail = [s.locality, s.postalCode && `CP ${s.postalCode}`, s.zone].filter(Boolean).join(' · ');
  if (street) doc.text(street, doc.page.margins.left, top + 14);
  if (tail) doc.fontSize(9).fillColor('#475569').text(tail, { width: 480 });
  const meta: string[] = [];
  if (s.carrier) meta.push(`Mensajería: ${s.carrier}`);
  if (s.cost != null) meta.push(`Costo envío: ${fmtMoney(s.cost, data.currency)}`);
  if (meta.length > 0) doc.fontSize(9).fillColor('#475569').text(meta.join('  ·  '), { width: 480 });
  doc.moveDown(0.8);
}

function renderItemsTable(doc: PDFKit.PDFDocument, data: OrderPdfData) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.y + 4;

  // Header row
  doc.rect(left, top, right - left, 18).fillColor('#1d4ed8').fill();
  doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold');
  const colsX = { qty: left + 8, desc: left + 60, unit: right - 200, total: right - 80 };
  doc.text('Cant.',   colsX.qty,   top + 5, { width: 40 });
  doc.text('Descripción', colsX.desc, top + 5, { width: colsX.unit - colsX.desc - 8 });
  doc.text('P. Unit.', colsX.unit,  top + 5, { width: 110, align: 'right' });
  doc.text('Total',   colsX.total - 8, top + 5, { width: 80, align: 'right' });
  doc.fillColor('#0f172a').font('Helvetica');

  let y = top + 22;
  for (const item of data.items) {
    if (y > doc.page.height - 200) { doc.addPage(); y = doc.page.margins.top; }
    doc.fontSize(9).fillColor('#0f172a').font('Helvetica');
    doc.text(String(item.quantity), colsX.qty, y, { width: 40 });
    doc.text(item.description, colsX.desc, y, { width: colsX.unit - colsX.desc - 8 });
    doc.text(fmtMoney(item.unitPrice, data.currency), colsX.unit, y, { width: 110, align: 'right' });
    doc.text(fmtMoney(item.total, data.currency), colsX.total - 8, y, { width: 80, align: 'right' });
    y += 18;
    doc.strokeColor('#e2e8f0').lineWidth(0.3).moveTo(left, y - 4).lineTo(right, y - 4).stroke();
  }
  doc.y = y + 6;
}

function renderTotalsBox(doc: PDFKit.PDFDocument, data: OrderPdfData) {
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.y + 8;
  const w = 220;
  const x = right - w;
  doc.rect(x, top, w, 32).fillColor('#0f172a').fill();
  doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
    .text('TOTAL', x + 12, top + 9, { width: 80 });
  doc.text(fmtMoney(data.totalAmount, data.currency), x + 90, top + 9, { width: w - 100, align: 'right' });
  doc.fillColor('#0f172a').font('Helvetica');
  doc.y = top + 42;
}

function renderNotesBlock(doc: PDFKit.PDFDocument, data: OrderPdfData) {
  doc.fontSize(10).fillColor('#475569').font('Helvetica-Bold').text('NOTAS');
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica').text(data.notes!, { width: 480 });
}

function renderFooter(doc: PDFKit.PDFDocument, c: CompanyConfig) {
  const y = doc.page.height - doc.page.margins.bottom - 30;
  doc.fontSize(8).fillColor('#94a3b8').font('Helvetica')
    .text(`${c.name} · ${c.address} · ${c.phone}`, doc.page.margins.left, y, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
    });
}
