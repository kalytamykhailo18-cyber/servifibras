/**
 * Marcos 2026-06-30: WhatsApp via QR (Baileys / WhatsApp Web protocol).
 * Conecta una cuenta WA escaneando un QR como WhatsApp Web — no
 * requiere verificación oficial de Meta Business. Mantiene la sesión
 * persistente en disco (multi-file auth state); reconecta solo al
 * boot si las creds están guardadas.
 *
 * Gates de seguridad:
 *   - WHATSAPP_QR_ENABLED debe estar true en .env para que el módulo
 *     inicialice el socket. False = el servicio carga pero no abre
 *     conexión a WhatsApp.
 *   - WHATSAPP_QR_AUTO_REPLY controla si los inbounds pasan por el
 *     ConversationHandler (agente responde) o se quedan en read-only.
 *   - Política operativa documentada: nunca correr contra el número
 *     principal de Servifibras sin observación previa en un test
 *     number, para evitar baneo de Meta.
 *
 * Reuso máximo:
 *   - Cada mensaje inbound se traduce a WhatsAppIncomingMessage y se
 *     enruta por el mismo ConversationHandler.handleWhatsAppMessage
 *     que ya alimenta el canal Meta Cloud — sin duplicar lógica de
 *     agente / handoff / scoring.
 *   - Outbound: sendMessage(to, text) que ConversationHandler invoca
 *     cuando WHATSAPP_QR_AUTO_REPLY=true y el reply final está listo.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { ConversationHandlerService } from '../conversations/conversation-handler.service';
import { UploadStorageService } from '../uploads/upload-storage.service';
import { WhatsAppIncomingMessage, WhatsAppMessageType } from '../../domain/entities/whatsapp-message.entity';
import { ContentType } from '@prisma/client';

type ConnectionStatus =
  | 'disabled'        // env flag off
  | 'starting'        // booting socket
  | 'waiting_qr'      // socket open, awaiting QR scan
  | 'connecting'      // QR scanned, finishing handshake
  | 'connected'       // ready for inbound/outbound
  | 'disconnected'    // socket closed
  | 'errored';        // crash, see lastError

@Injectable()
export class WhatsappQrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappQrService.name);
  private sock: WASocket | null = null;
  private status: ConnectionStatus = 'disabled';
  private lastQrDataUrl: string | null = null;
  private lastError: string | null = null;
  private connectedJid: string | null = null;
  private connectedAt: Date | null = null;
  private startedAt: Date | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    // Optional para que arranques de scripts / E2E que no levantan el
    // ConversationHandler completo. Sin handler los inbounds se loguean
    // pero no se procesan.
    @Optional() private readonly conversationHandler?: ConversationHandlerService,
    // Uploads: guardamos imágenes / audios / videos / documentos de
    // WhatsApp en la misma carpeta que el resto de attachments del CRM
    // para que aparezcan en el hilo con miniatura y click-to-download.
    @Optional() private readonly uploads?: UploadStorageService,
  ) {}

  private get enabled(): boolean {
    return (process.env.WHATSAPP_QR_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  private get sessionDir(): string {
    return process.env.WHATSAPP_QR_SESSION_DIR ?? '/var/lib/servifibras/whatsapp-qr-session';
  }

  private get autoReply(): boolean {
    return (process.env.WHATSAPP_QR_AUTO_REPLY ?? 'false').toLowerCase() === 'true';
  }

  private get accountLabel(): string {
    return process.env.WHATSAPP_QR_ACCOUNT_LABEL ?? 'Test';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.status = 'disabled';
      this.logger.log('WHATSAPP_QR_ENABLED=false — service idle');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // best-effort
      }
      this.sock = null;
    }
  }

  /**
   * Boot the socket — reads existing creds from sessionDir if present,
   * otherwise emits a QR to scan. Idempotent: no-op if already
   * connecting/connected.
   */
  async start(): Promise<{ ok: boolean; status: ConnectionStatus; reason?: string }> {
    if (!this.enabled) {
      return { ok: false, status: 'disabled', reason: 'WHATSAPP_QR_ENABLED=false' };
    }
    if (this.sock && (this.status === 'connecting' || this.status === 'connected' || this.status === 'waiting_qr')) {
      return { ok: true, status: this.status };
    }
    try {
      this.status = 'starting';
      this.startedAt = new Date();
      this.lastError = null;
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      const sock = makeWASocket({
        auth: state,
        // Baileys' default logger is pino — silence it to keep our own
        // nestjs logger as the single source of truth.
        printQRInTerminal: false,
        // Browser identity — appears in WhatsApp > "Linked devices".
        // Cambiar permite a Marcos distinguir cuál de los devices es
        // el server cuando va a desconectar.
        browser: ['Servifibras CRM', 'Chrome', '1.0'],
      });
      this.sock = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u).catch((e) => this.logger.error(`onConnectionUpdate: ${e?.message ?? e}`)));
      sock.ev.on('messages.upsert', (m) => this.onMessagesUpsert(m).catch((e) => this.logger.error(`onMessagesUpsert: ${e?.message ?? e}`)));
      return { ok: true, status: this.status };
    } catch (err: any) {
      this.status = 'errored';
      this.lastError = err?.message ?? String(err);
      this.logger.error(`start failed: ${this.lastError}`);
      return { ok: false, status: this.status, reason: this.lastError };
    }
  }

  /**
   * Hard reset — close socket, wipe session dir, restart so next QR
   * scan can bind a different number. Marcos usa esto cuando quiere
   * cambiar la cuenta vinculada.
   */
  async disconnect(opts?: { wipeSession?: boolean }): Promise<{ ok: boolean }> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try { await this.sock.logout(); } catch { /* ignored — socket may already be dead */ }
      try { this.sock.end(undefined); } catch { /* ignored */ }
      this.sock = null;
    }
    if (opts?.wipeSession) {
      try {
        if (fs.existsSync(this.sessionDir)) {
          fs.rmSync(this.sessionDir, { recursive: true, force: true });
        }
      } catch (err: any) {
        this.logger.warn(`wipeSession failed: ${err.message}`);
      }
    }
    this.status = 'disconnected';
    this.lastQrDataUrl = null;
    this.connectedJid = null;
    this.connectedAt = null;
    return { ok: true };
  }

  /**
   * Manda un mensaje saliente. `to` puede ser número (sin +, ej.
   * "5491133334444") o un JID ya formado ("5491133334444@s.whatsapp.net").
   * El destino se normaliza a JID. Devuelve success + messageId si Baileys
   * confirma el envío.
   */
  async sendMessage(to: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.sock || this.status !== 'connected') {
      return { success: false, error: `not connected (status=${this.status})` };
    }
    const jid = this.toJid(to);
    try {
      const res = await this.sock.sendMessage(jid, { text });
      return { success: true, messageId: res?.key?.id ?? undefined };
    } catch (err: any) {
      this.logger.error(`sendMessage to ${jid} failed: ${err?.message ?? err}`);
      return { success: false, error: err?.message ?? String(err) };
    }
  }

  getStatus(): {
    enabled: boolean;
    autoReply: boolean;
    accountLabel: string;
    status: ConnectionStatus;
    connectedJid: string | null;
    connectedAt: string | null;
    startedAt: string | null;
    lastError: string | null;
    sessionDirExists: boolean;
  } {
    return {
      enabled: this.enabled,
      autoReply: this.autoReply,
      accountLabel: this.accountLabel,
      status: this.status,
      connectedJid: this.connectedJid,
      connectedAt: this.connectedAt?.toISOString() ?? null,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastError: this.lastError,
      sessionDirExists: fs.existsSync(this.sessionDir) && fs.readdirSync(this.sessionDir).length > 0,
    };
  }

  /** PNG-encoded QR data URL — null when no QR pending. */
  getQrDataUrl(): string | null {
    return this.lastQrDataUrl;
  }

  private toJid(to: string): string {
    if (to.includes('@')) return to;
    return `${to.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  private fromJid(jid: string): string {
    return jid.split('@')[0] ?? jid;
  }

  /**
   * Marcos 2026-07-06: descarga la media adjunta de un mensaje WA
   * (imagen / video / audio / voice / documento / sticker) y la
   * persiste con UploadStorageService para que aparezca como attachment
   * en la conversación del CRM. Devuelve null cuando no hay media
   * usable (mensaje texto puro, mime bloqueado por el allow-list,
   * download fallado, o cuando UploadStorageService no está wireado
   * — p.ej. en E2E). Cuando hay caption (image/video/document lo
   * permiten), lo devuelve por separado para que el caller lo guarde
   * como content del mensaje.
   */
  private async extractMediaAttachment(msg: WAMessage): Promise<{
    attachment: {
      url: string;
      name: string;
      mime: string;
      size: number;
      contentType: ContentType;
    };
    caption: string;
  } | null> {
    if (!this.uploads || !this.sock) return null;
    const m = msg.message;
    if (!m) return null;

    // Detectar el shape del mensaje y sacar mime + caption + nombre.
    type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';
    let kind: MediaKind | null = null;
    let mime = '';
    let caption = '';
    let originalName = '';

    if (m.imageMessage) {
      kind = 'image';
      mime = m.imageMessage.mimetype || 'image/jpeg';
      caption = (m.imageMessage.caption || '').trim();
      originalName = 'foto.jpg';
    } else if (m.videoMessage) {
      kind = 'video';
      mime = m.videoMessage.mimetype || 'video/mp4';
      caption = (m.videoMessage.caption || '').trim();
      originalName = 'video.mp4';
    } else if (m.audioMessage) {
      kind = 'audio';
      mime = m.audioMessage.mimetype || 'audio/ogg';
      // PTT = push-to-talk (nota de voz)
      originalName = m.audioMessage.ptt ? 'nota-de-voz.ogg' : 'audio.ogg';
    } else if (m.documentMessage) {
      kind = 'document';
      mime = m.documentMessage.mimetype || 'application/octet-stream';
      caption = (m.documentMessage.caption || '').trim();
      originalName = m.documentMessage.fileName || 'documento';
    } else if (m.stickerMessage) {
      kind = 'sticker';
      mime = m.stickerMessage.mimetype || 'image/webp';
      originalName = 'sticker.webp';
    }
    if (!kind) return null;

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: this.sock.logger as any,
          reuploadRequest: this.sock.updateMediaMessage,
        },
      );
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        this.logger.warn(`downloadMediaMessage returned empty buffer for ${kind}`);
        return null;
      }
      // Normalizar mime: WhatsApp a veces reporta 'audio/ogg; codecs=opus'
      // — cortamos al primer ';' para que matchee el allow-list.
      const cleanMime = mime.split(';')[0].trim().toLowerCase();
      const stored = await this.uploads.store({
        buffer,
        originalname: originalName,
        mimetype: cleanMime,
        size: buffer.length,
      });
      return {
        attachment: {
          url: stored.url,
          name: stored.name,
          mime: stored.mime,
          size: stored.size,
          contentType: stored.contentType,
        },
        caption,
      };
    } catch (err: any) {
      this.logger.warn(`Failed to download/store WA media (${kind}): ${err?.message ?? err}`);
      return null;
    }
  }

  private async onConnectionUpdate(update: any): Promise<void> {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      // El QR es un string base64 raw del protocolo WhatsApp Web;
      // lo encodeamos a PNG dataURL para mostrarlo en el panel admin.
      try {
        this.lastQrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        this.status = 'waiting_qr';
        this.logger.log(`QR ready — scan from WhatsApp > Linked devices`);
      } catch (err: any) {
        this.logger.warn(`QR encode failed: ${err.message}`);
      }
    }
    if (connection === 'open') {
      this.status = 'connected';
      this.connectedAt = new Date();
      this.connectedJid = this.sock?.user?.id ?? null;
      this.lastQrDataUrl = null;
      this.lastError = null;
      this.logger.log(`Connected as ${this.connectedJid} (label=${this.accountLabel})`);
    } else if (connection === 'close') {
      const status = this.status;
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      this.status = 'disconnected';
      this.logger.warn(`Connection closed (code=${code}, loggedOut=${loggedOut}, prev=${status})`);
      if (loggedOut) {
        // El usuario hizo logout desde el teléfono — limpiamos session
        // para que la próxima start() reemita QR fresco.
        try { fs.rmSync(this.sessionDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        this.connectedJid = null;
      } else {
        // Reintentar tras un delay con backoff suave. No bloqueamos boot
        // — el watchdog re-arranca después.
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start().catch((e) => this.logger.error(`reconnect start failed: ${e?.message ?? e}`));
          }, 5000);
        }
      }
    }
  }

  private async onMessagesUpsert(m: { messages: WAMessage[]; type: string }): Promise<void> {
    if (m.type !== 'notify') return; // Skip history syncs.
    for (const msg of m.messages) {
      if (!msg.message) continue;
      const remoteJid = msg.key.remoteJid ?? '';
      // Marcos 2026-07-03: WhatsApp roll-out of Linked Identity (LID) —
      // muchos contactos ahora llegan como `<number>@lid` en lugar de
      // `<phone>@s.whatsapp.net`. Aceptamos ambos formatos y dejamos
      // afuera solo los que sabemos que NO son 1:1 con un cliente:
      // grupos (`@g.us`), status broadcast (`status@broadcast`), y
      // los newsletters (`@newsletter`).
      if (
        remoteJid.endsWith('@g.us') ||
        remoteJid.endsWith('@broadcast') ||
        remoteJid.endsWith('@newsletter')
      ) {
        continue;
      }
      if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@lid')) {
        this.logger.debug(`Skipping unknown JID scheme: ${remoteJid}`);
        continue;
      }
      // Marcos 2026-07-06: si el mensaje trae media (foto / video /
      // audio / voice / documento / sticker), la bajamos y la
      // guardamos como attachment. El texto del mensaje es la caption
      // cuando existe (o vacío para audio/sticker/documento sin
      // caption). Para mensajes de sólo texto seguimos el path viejo.
      const media = await this.extractMediaAttachment(msg);
      const text = media
        ? media.caption
        : (
            msg.message.conversation
            ?? msg.message.extendedTextMessage?.text
            ?? ''
          );
      // Si NO hay media y NO hay texto → nada que guardar (mensaje
      // vacío, marker, etc).
      if (!media && !text.trim()) continue;
      // Marcos 2026-07-03: para JIDs @lid preferimos el phone real que
      // Baileys expone en `senderPn` (senderPhoneNumber). Sin senderPn,
      // caemos al número crudo del JID — el CRM mostrará el LID como
      // identificador, aún matcheable por unicidad. Contactos futuros
      // que respondan desde el mismo LID se agrupan en la misma conv.
      // Marcos 2026-07-06: teléfono real del contacto. WhatsApp está
      // rolando LID (Linked Identity) — muchos contactos llegan con
      // remoteJid=<digits>@lid en vez del <phone>@s.whatsapp.net que
      // el CRM espera. Baileys 7 expone en `msg.key.remoteJidAlt` el
      // JID en el otro esquema (o sea, cuando primary es LID el Alt
      // trae el phone-based JID). También algunos mensajes vienen con
      // senderPn (senderPhoneNumber) directo. Hierarchy:
      //   1. senderPn si trae phone real
      //   2. remoteJidAlt si es @s.whatsapp.net (contiene el phone)
      //   3. remoteJid si YA es @s.whatsapp.net
      //   4. remoteJid crudo (LID) — último recurso, contact identifier
      //      queda como LID digits pero al menos matcheamos por unicidad.
      const senderPn: string | undefined =
        (msg.key as any)?.senderPn ?? (msg as any)?.senderPn ?? undefined;
      const remoteJidAlt: string | undefined = (msg.key as any)?.remoteJidAlt;
      let realPhoneJid: string | null = null;
      if (senderPn && senderPn.length > 0) {
        realPhoneJid = senderPn.includes('@') ? senderPn : `${senderPn}@s.whatsapp.net`;
      } else if (remoteJidAlt && remoteJidAlt.endsWith('@s.whatsapp.net')) {
        realPhoneJid = remoteJidAlt;
      } else if (remoteJid.endsWith('@s.whatsapp.net')) {
        realPhoneJid = remoteJid;
      }
      const from = this.fromJid(realPhoneJid ?? remoteJid);
      // Si el `from` (phone real) es distinto del identificador crudo
      // del JID (LID digits), guardamos ese último como fallbackLookup
      // para que el handler pueda migrar el contacto legacy.
      const lidDigits = this.fromJid(remoteJid);
      const fallbackLookup = realPhoneJid && lidDigits !== from ? lidDigits : null;

      // Marcos 2026-07-06: si el mensaje viene con fromMe=true significa
      // que alguien del equipo respondió desde el celular (no desde el
      // CRM). Espejeamos ese texto en la conversación del CRM para que
      // el hilo quede completo en un solo lugar. Antes tirábamos estos
      // upserts como "own outgoing echo".
      const mediaTag = media ? ` [${media.attachment.mime}]` : '';
      if (msg.key.fromMe) {
        this.logger.log(`Phone-side outbound to ${from} (jid=${remoteJid})${mediaTag}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
        if (!this.conversationHandler) continue;
        const ts = Number(msg.messageTimestamp);
        await this.conversationHandler.recordPhoneSideOutbound({
          to: from,
          text: text.trim(),
          jid: remoteJid,
          waMessageId: msg.key.id ?? `qr-${Date.now()}`,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          fallbackLookup,
          attachment: media?.attachment ?? null,
        });
        continue;
      }

      this.logger.log(`Inbound from ${from} (jid=${remoteJid})${mediaTag}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
      if (!this.conversationHandler) {
        this.logger.warn(`No ConversationHandler wired — inbound dropped`);
        continue;
      }

      // Marcos 2026-07-06: media del cliente (foto / audio / video /
      // documento / sticker) va por un path aparte — se guarda con
      // attachment y NO llama al agente (no tenemos visión y el
      // operador tiene que ver el archivo). Sólo texto puro sigue por
      // el pipeline del agente.
      if (media) {
        const ts = Number(msg.messageTimestamp);
        await this.conversationHandler.recordWhatsAppMediaInbound({
          from,
          jid: remoteJid,
          caption: text.trim(),
          waMessageId: msg.key.id ?? `qr-${Date.now()}`,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          fallbackLookup,
          attachment: media.attachment,
        });
        continue;
      }

      if (!this.autoReply) {
        this.logger.debug(`WHATSAPP_QR_AUTO_REPLY=false — not invoking handler`);
        continue;
      }
      try {
        // Traducción al shape canónico que ya consume el handler.
        const ts = Number(msg.messageTimestamp);
        const incoming = new WhatsAppIncomingMessage(
          msg.key.id ?? `qr-${Date.now()}`,
          from,
          Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          WhatsAppMessageType.TEXT,
          text.trim(),
          null,
          null,
          remoteJid,
          fallbackLookup,
        );
        const result = await this.conversationHandler.handleWhatsAppMessage(incoming);
        if (result.success && result.response) {
          // Auto-reply usa el mismo JID del inbound para no perder el
          // esquema (@lid vs @s.whatsapp.net) en el retorno.
          await this.sendMessage(remoteJid, result.response);
        }
      } catch (err: any) {
        this.logger.error(`handler invocation failed for ${from}: ${err?.message ?? err}`);
      }
    }
  }
}
