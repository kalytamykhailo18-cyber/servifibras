/**
 * ADAPTERS LAYER — Conversation PDF builder.
 *
 * Renders a clean, plain-Spanish print of a customer conversation. Used
 * for legal retention, "defensa al consumidor" requests and customer
 * dispute archives. Format:
 *
 *   - Header: company name + conversation id + contact + channel + date.
 *   - Each message as a separate block with sender label, timestamp, and
 *     wrapped text. Customer messages are tinted blue; AI replies violet;
 *     human staff in green/orange depending on role. Internal notes are
 *     marked clearly so the recipient understands they were never sent
 *     to the customer.
 *   - Footer: page numbers + export timestamp.
 */

import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');

export interface ConversationPdfMessage {
  id: string;
  sender: string; // CUSTOMER / AI / BRENDA / FRANCO / ALDO / ADMIN
  isFromAI: boolean;
  content: string;
  timestamp: Date;
}
export interface ConversationPdfNote {
  id: string;
  authorName: string;
  content: string;
  createdAt: Date;
}
export interface ConversationPdfData {
  id: string;
  channel: string;
  status: string;
  createdAt: Date;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
  messages: ConversationPdfMessage[];
  internalNotes: ConversationPdfNote[];
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

function fmtDateTime(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

const SENDER_LABEL: Record<string, string> = {
  CUSTOMER: 'Cliente',
  AI:       'IA',
  BRENDA:   'Brenda',
  FRANCO:   'Franco',
  ALDO:     'Aldo',
  ADMIN:    'Admin',
};

function senderTint(sender: string, isFromAI: boolean): { bg: string; fg: string } {
  if (sender === 'CUSTOMER') return { bg: '#eff6ff', fg: '#1d4ed8' };
  if (isFromAI || sender === 'AI') return { bg: '#f5f3ff', fg: '#6d28d9' };
  if (sender === 'BRENDA') return { bg: '#fdf2f8', fg: '#be185d' };
  if (sender === 'FRANCO') return { bg: '#ecfdf5', fg: '#047857' };
  if (sender === 'ALDO')   return { bg: '#fff7ed', fg: '#c2410c' };
  return                       { bg: '#f1f5f9', fg: '#334155' };
}

export function buildConversationPdf(data: ConversationPdfData): Promise<Buffer> {
  const companyName = envStr('QUOTE_COMPANY_NAME', 'Servifibras');
  const margin = envNum('CONVERSATION_PDF_MARGIN', 36);
  const pageSize = envStr('CONVERSATION_PDF_PAGE_SIZE', 'A4');

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: pageSize,
        margin,
        info: {
          Title: `Conversación ${data.id.slice(0, 8)}`,
          Author: companyName,
          Subject: 'Conversación con cliente',
        },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderHeader(doc, companyName, data);
      renderTimeline(doc, data);
      renderFooter(doc);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderHeader(doc: PDFKit.PDFDocument, companyName: string, data: ConversationPdfData) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const top = doc.y;

  // Optional logo on the left if it's available — same path as quote PDF
  const logoPath = envStr('QUOTE_COMPANY_LOGO_PATH', path.join(process.cwd(), 'assets', 'logo.jpg'));
  let textX = margin;
  try {
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, margin, top, { width: 50 });
      textX = margin + 60;
    }
  } catch { /* skip */ }

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a')
    .text(`${companyName} — Conversación`, textX, top, { width: pageW - textX - margin });

  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  doc.text(`ID: ${data.id}`, textX, doc.y);
  doc.text(`Canal: ${data.channel}   ·   Estado: ${data.status}`);
  doc.text(`Iniciada: ${fmtDateTime(data.createdAt)}`);

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text('Contacto', textX, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  doc.text(`Nombre: ${data.contact.name ?? '—'}`);
  doc.text(`Teléfono: ${data.contact.phone ?? '—'}`);
  doc.text(`Email: ${data.contact.email ?? '—'}`);

  doc.moveDown(0.6);
  doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).strokeColor('#cbd5e1').stroke();
  doc.moveDown(0.6);
  doc.fillColor('#0f172a');
}

function renderTimeline(doc: PDFKit.PDFDocument, data: ConversationPdfData) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const innerW = pageW - margin * 2;

  // Merge messages and internal notes on a single sorted timeline so the
  // archive matches what the operator saw in the panel.
  type Item =
    | { kind: 'msg'; ts: number; data: ConversationPdfMessage }
    | { kind: 'note'; ts: number; data: ConversationPdfNote };
  const items: Item[] = [];
  for (const m of data.messages) items.push({ kind: 'msg', ts: m.timestamp.getTime(), data: m });
  for (const n of data.internalNotes) items.push({ kind: 'note', ts: n.createdAt.getTime(), data: n });
  items.sort((a, b) => a.ts - b.ts);

  if (items.length === 0) {
    doc.fontSize(10).fillColor('#94a3b8').text('Sin mensajes registrados.', margin, doc.y);
    return;
  }

  doc.font('Helvetica');
  for (const it of items) {
    if (it.kind === 'msg') {
      const { sender, isFromAI, content, timestamp } = it.data;
      const tint = senderTint(sender, isFromAI);
      // Header line — sender + timestamp
      doc.fontSize(9).fillColor(tint.fg).font('Helvetica-Bold')
        .text(`${SENDER_LABEL[sender] ?? sender}${isFromAI && sender !== 'AI' ? ' · IA' : ''}`,
              margin, doc.y, { continued: true });
      doc.font('Helvetica').fillColor('#94a3b8')
        .text(`   ${fmtDateTime(timestamp)}`);
      // Message body in a tinted block
      const startY = doc.y;
      const textHeight = doc.heightOfString(content || '', { width: innerW - 16 });
      const blockH = Math.max(20, textHeight + 12);
      doc.rect(margin, startY, innerW, blockH).fillAndStroke(tint.bg, tint.bg);
      doc.fillColor('#0f172a').fontSize(10)
        .text(content || '(sin contenido)', margin + 8, startY + 6, {
          width: innerW - 16,
        });
      doc.y = startY + blockH + 6;
    } else {
      const { authorName, content, createdAt } = it.data;
      // Internal-note styling — dashed border + "NOTA INTERNA" label so
      // someone reading the export knows it never went to the customer.
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#b45309')
        .text(`Nota interna · ${authorName}`, margin, doc.y, { continued: true });
      doc.font('Helvetica').fillColor('#94a3b8')
        .text(`   ${fmtDateTime(createdAt)}`);
      const startY = doc.y;
      const textHeight = doc.heightOfString(content || '', { width: innerW - 16 });
      const blockH = Math.max(20, textHeight + 12);
      doc.save();
      doc.rect(margin, startY, innerW, blockH).fillAndStroke('#fffbeb', '#fcd34d');
      doc.restore();
      doc.fillColor('#92400e').fontSize(10)
        .text(content || '(sin contenido)', margin + 8, startY + 6, {
          width: innerW - 16,
        });
      doc.y = startY + blockH + 6;
    }

    // Page break when close to the bottom — pdfkit auto-paginates within
    // text() but our explicit rect blocks need the manual check.
    if (doc.y > doc.page.height - margin - 60) {
      doc.addPage();
    }
  }

  doc.fillColor('#0f172a');
}

function renderFooter(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const total = range.start + range.count;
  const margin = doc.page.margins.left;
  const exportedAt = fmtDateTime(new Date());

  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const y = pageH - margin - 14;
    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Exportado ${exportedAt}   ·   Página ${i + 1} de ${total}`,
            margin, y, {
              width: pageW - margin * 2, align: 'right',
            });
  }
}
