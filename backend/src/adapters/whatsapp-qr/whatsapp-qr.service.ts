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
import { ContentType, PrismaClient } from '@prisma/client';

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
  private readonly prisma = new PrismaClient();
  private sock: WASocket | null = null;
  private status: ConnectionStatus = 'disabled';
  private lastQrDataUrl: string | null = null;
  private lastError: string | null = null;
  private connectedJid: string | null = null;
  private connectedAt: Date | null = null;
  private startedAt: Date | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Marcos 2026-07-30: Baileys se quedó 30+ horas en `starting` sin emitir
  // ni QR ni connection.update — la única forma de reactivar era un
  // deploy manual. Este watchdog audita cada N segundos: si llevamos más
  // de `WHATSAPP_QR_STARTING_TIMEOUT_MS` en un estado transitorio
  // (starting / connecting / waiting_qr) sin resolver, forzamos un hard
  // reset y re-start(). Sin esto, cualquier fallo silencioso del socket
  // vuelve a producir la misma parálisis.
  private watchdogTimer: NodeJS.Timeout | null = null;
  private transientSince: number | null = null;

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
    this.startWatchdog();
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
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

  private get startingTimeoutMs(): number {
    const raw = Number(process.env.WHATSAPP_QR_STARTING_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
  }

  private get watchdogIntervalMs(): number {
    const raw = Number(process.env.WHATSAPP_QR_WATCHDOG_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.watchdogTick(), this.watchdogIntervalMs);
    // Un `unref` para que el timer no bloquee el process exit durante el
    // shutdown de tests / graceful stop.
    if (typeof this.watchdogTimer.unref === 'function') this.watchdogTimer.unref();
  }

  private isTransient(): boolean {
    return this.status === 'starting' || this.status === 'connecting' || this.status === 'waiting_qr';
  }

  private watchdogTick(): void {
    if (!this.enabled) return;
    if (!this.isTransient()) {
      this.transientSince = null;
      return;
    }
    const now = Date.now();
    if (this.transientSince == null) {
      this.transientSince = now;
      return;
    }
    const stuckMs = now - this.transientSince;
    if (stuckMs < this.startingTimeoutMs) return;
    this.logger.warn(
      `Watchdog: WhatsApp stuck in "${this.status}" for ${Math.round(stuckMs / 1000)}s — forcing hard reset`,
    );
    this.transientSince = null;
    this.hardResetAndRestart().catch((e) =>
      this.logger.error(`Watchdog hard reset failed: ${e?.message ?? e}`),
    );
  }

  private async hardResetAndRestart(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* best-effort */ }
      this.sock = null;
    }
    this.status = 'disconnected';
    // Pequeño respiro para no gastar rate-limit del server WA con
    // reconexiones back-to-back.
    await new Promise((r) => setTimeout(r, 1_000));
    await this.start();
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
    // Marcos 2026-07-30: `starting` estaba fuera de este check, así que
    // dos llamados a start() cuando un socket ya se estaba booteando
    // creaban un socket huérfano cuyos handlers seguían activos —
    // exacto camino que dejó Baileys en un limbo silencioso 30h el 07-29.
    if (this.sock && (this.status === 'starting' || this.status === 'connecting' || this.status === 'connected' || this.status === 'waiting_qr')) {
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
      // Marcos 2026-08-10 (WhatsApp 13:12 AR): WhatsApp sincroniza el
      // estado unreadCount de cada chat entre dispositivos linkeados.
      // Cuando Marcos abre un chat en el celular, Baileys recibe un
      // chats.update con unreadCount=0. Usamos esa señal para apagar
      // hasUnreadCustomer en la Conversation, alineando el conteo del
      // CRM con lo que WhatsApp Web muestra ("no leidos = 8").
      sock.ev.on('chats.update', (updates) => this.onChatsUpdate(updates).catch((e) => this.logger.error(`onChatsUpdate: ${e?.message ?? e}`)));
      // Marcos 2026-08-11 (video 7:19 AR mostrando 154 stuck): el sync
      // de arriba sólo captura reads FORWARD desde el deploy — chats que
      // Marcos ya había leído antes en el celular quedaron marcados en
      // el CRM para siempre. Al conectar Baileys emite messaging-history.set
      // con TODO el chat store del teléfono, cada uno con su unreadCount
      // real. Reconciliamos en bulk: chats con unreadCount=0/null → apagar
      // flag; con unreadCount>0 → prenderlo (cubre chats donde el cliente
      // escribió mientras el CRM estaba desconectado). chats.upsert cubre
      // chats nuevos que aparecen post-connection.
      sock.ev.on('messaging-history.set', (h: any) => this.reconcileFromChatList(h?.chats ?? [], 'messaging-history.set').catch((e) => this.logger.error(`messaging-history.set reconcile: ${e?.message ?? e}`)));
      sock.ev.on('chats.upsert', (chats: any[]) => this.reconcileFromChatList(chats ?? [], 'chats.upsert').catch((e) => this.logger.error(`chats.upsert reconcile: ${e?.message ?? e}`)));
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

  /**
   * Marcos 2026-08-04 (WhatsApp 09:19 AR): "los audios no se están
   * enviando". Root cause: WhatsAppService.sendMedia iba siempre a Meta
   * Cloud API, que no está configurado en prod — el env
   * WHATSAPP_ACCESS_TOKEN está vacío, así que sendMedia devolvía
   * "WhatsApp not configured" en silencio y el audio jamás cruzaba.
   * Ahora sendMedia también prueba Baileys primero (mismo criterio
   * que sendMessage/text). Baileys soporta audio/video/image/document
   * y hace la conversión interna cuando el mime del cliente no
   * matchea lo que WhatsApp acepta (ej. audio/webm del MediaRecorder
   * del browser → OGG Opus voice-note en el celular del cliente).
   */
  async sendMedia(args: {
    to: string;
    buffer: Buffer;
    mime: string;
    filename?: string;
    caption?: string;
    contentType: 'IMAGE' | 'VIDEO' | 'VOICE' | 'AUDIO' | 'DOCUMENT';
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.sock || this.status !== 'connected') {
      return { success: false, error: `not connected (status=${this.status})` };
    }
    const jid = this.toJid(args.to);
    try {
      let payload: any;
      switch (args.contentType) {
        case 'VOICE':
          payload = { audio: args.buffer, mimetype: args.mime, ptt: true };
          break;
        case 'AUDIO':
          payload = { audio: args.buffer, mimetype: args.mime, ptt: false };
          break;
        case 'IMAGE':
          payload = { image: args.buffer, mimetype: args.mime, caption: args.caption };
          break;
        case 'VIDEO':
          payload = { video: args.buffer, mimetype: args.mime, caption: args.caption };
          break;
        case 'DOCUMENT':
          payload = {
            document: args.buffer,
            mimetype: args.mime,
            fileName: args.filename ?? 'archivo',
            caption: args.caption,
          };
          break;
        default:
          return { success: false, error: `Unsupported contentType ${args.contentType}` };
      }
      const res = await this.sock.sendMessage(jid, payload);
      return { success: true, messageId: res?.key?.id ?? undefined };
    } catch (err: any) {
      this.logger.error(`sendMedia to ${jid} failed: ${err?.message ?? err}`);
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

  // Marcos 2026-07-31: cache de fotos de perfil por JID. Baileys puede
  // rate-limitar si le pedimos profilePictureUrl en cada mensaje del
  // mismo contacto; con TTL de 24h la refetcheamos ocasionalmente para
  // capturar cambios sin castigar al server WA.
  private profilePicCache = new Map<string, { url: string | null; at: number }>();
  private get profilePicTtlMs(): number {
    const raw = Number(process.env.WHATSAPP_QR_PROFILE_PIC_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 86_400_000;
  }

  async fetchProfilePictureUrl(jid: string): Promise<string | null> {
    if (!this.sock || this.status !== 'connected') return null;
    const cached = this.profilePicCache.get(jid);
    if (cached && Date.now() - cached.at < this.profilePicTtlMs) return cached.url;
    try {
      const url = await this.sock.profilePictureUrl(jid, 'image');
      this.profilePicCache.set(jid, { url: url ?? null, at: Date.now() });
      return url ?? null;
    } catch {
      // Sin foto pública, cliente con privacidad restringida, o rate
      // limit — cacheamos null para no reintentar en el próximo mensaje.
      this.profilePicCache.set(jid, { url: null, at: Date.now() });
      return null;
    }
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

  /**
   * Marcos 2026-08-10 (WhatsApp 13:12 AR): sincroniza el estado de
   * lectura desde el celular. WhatsApp mantiene el unreadCount por
   * chat consistente entre dispositivos linkeados. Cuando Marcos abre
   * un chat en su celular, Baileys recibe un chats.update con
   * unreadCount=0. Reflejamos esa señal apagando hasUnreadCustomer en
   * la Conversation correspondiente, para que la tab "No leídas" del
   * CRM muestre exactamente lo mismo que el WhatsApp de Marcos.
   *
   * Sólo actuamos sobre updates que traen unreadCount=0 (el "leyeron"
   * afirmativo) — updates sin ese campo o con valor >0 se ignoran, la
   * fila queda como estaba. Aciertos sobre chats que no matchean
   * ninguna Conversation en nuestra DB son no-op silencioso.
   */
  /**
   * Bidirectional reconciler: dado un lote de Chat[] (o ChatUpdate[])
   * del store de Baileys, alinea `hasUnreadCustomer` en la DB con lo
   * que reporta el teléfono. Se apagan los chats con unreadCount 0/null,
   * se prenden los que traen >0. Comparte la lógica de chunking con
   * onChatsUpdate — reutilizada por messaging-history.set (bulk backfill
   * en connection open) y chats.upsert (chats nuevos post-connection).
   * unreadCount=-1 (marcado no-leído manualmente por el user) se ignora
   * — no queremos pisarlo desde el CRM.
   */
  private async reconcileFromChatList(
    chats: Array<{ id?: string | null; unreadCount?: number | null }>,
    origin: string,
  ): Promise<void> {
    if (!Array.isArray(chats) || chats.length === 0) return;
    const readJids: string[] = [];
    const unreadJids: string[] = [];
    for (const c of chats) {
      const jid = c?.id;
      if (!jid || typeof jid !== 'string') continue;
      const uc = c.unreadCount;
      if (uc === 0 || uc === null || uc === undefined) readJids.push(jid);
      else if (typeof uc === 'number' && uc > 0) unreadJids.push(jid);
    }
    if (readJids.length === 0 && unreadJids.length === 0) return;
    try {
      const CHUNK = 25;
      let cleared = 0;
      let flagged = 0;
      for (let i = 0; i < readJids.length; i += CHUNK) {
        const slice = readJids.slice(i, i + CHUNK);
        const orClauses = slice.map((j) => ({
          contact: { is: { metadata: { path: ['waJid'], equals: j } } },
        }));
        const res = await this.prisma.conversation.updateMany({
          where: { channel: 'WHATSAPP', hasUnreadCustomer: true, OR: orClauses },
          data: { hasUnreadCustomer: false },
        });
        cleared += res.count;
      }
      for (let i = 0; i < unreadJids.length; i += CHUNK) {
        const slice = unreadJids.slice(i, i + CHUNK);
        const orClauses = slice.map((j) => ({
          contact: { is: { metadata: { path: ['waJid'], equals: j } } },
        }));
        const res = await this.prisma.conversation.updateMany({
          where: { channel: 'WHATSAPP', hasUnreadCustomer: false, OR: orClauses },
          data: { hasUnreadCustomer: true },
        });
        flagged += res.count;
      }
      if (cleared > 0 || flagged > 0) {
        this.logger.log(
          `${origin} reconcile: cleared=${cleared} flagged=${flagged} (from ${chats.length} chats)`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`reconcileFromChatList (${origin}) failed: ${err?.message ?? err}`);
    }
  }

  private async onChatsUpdate(updates: Array<{ id?: string; unreadCount?: number | null }>): Promise<void> {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const readJids: string[] = [];
    for (const u of updates) {
      const jid = u?.id;
      if (!jid || typeof jid !== 'string') continue;
      // unreadCount puede venir 0, null (limpio), o -1 (marcado como
      // no leído explícitamente por el user — ignoramos, no queremos
      // pisarlo). Sólo la señal de "0" (o null) equivale a "leído".
      const uc = u.unreadCount;
      if (uc !== 0 && uc !== null) continue;
      readJids.push(jid);
    }
    if (readJids.length === 0) return;
    try {
      // La Conversation tiene contact.metadata.waJid con el jid
      // completo. Buscamos por eso. Prisma no puede matchear directo
      // dentro del JSON con `contains` para strings exactos, así que
      // usamos el string exacto en el where.
      const contacts = await this.prisma.contact.findMany({
        where: {
          metadata: {
            path: ['waJid'],
            equals: undefined,   // Prisma trick: reemplazado por OR abajo
          },
        },
        select: { id: true },
      }).catch(() => [] as Array<{ id: string }>);
      void contacts; // placeholder — path/equals=undefined no matchea, cambiamos abajo
      // Preferimos un update masivo por lista de jids. Como Prisma
      // JSON `path` no soporta `in`, iteramos por chunk pequeño.
      const CHUNK = 25;
      let totalCleared = 0;
      for (let i = 0; i < readJids.length; i += CHUNK) {
        const slice = readJids.slice(i, i + CHUNK);
        const orClauses = slice.map((j) => ({
          contact: { is: { metadata: { path: ['waJid'], equals: j } } },
        }));
        const res = await this.prisma.conversation.updateMany({
          where: { channel: 'WHATSAPP', hasUnreadCustomer: true, OR: orClauses },
          data: { hasUnreadCustomer: false },
        });
        totalCleared += res.count;
      }
      if (totalCleared > 0) {
        this.logger.log(`chats.update: cleared hasUnreadCustomer on ${totalCleared} conversations (phone-side read)`);
      }
    } catch (err: any) {
      this.logger.warn(`onChatsUpdate failed: ${err?.message ?? err}`);
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
    // Marcos 2026-08-03 (WhatsApp 14:23 AR): "una vez que respondo en
    // whatsapp web los que no me aparecen en el crm, luego de responder
    // si me aparecen". Root cause: 4 conversaciones en los últimos 3
    // días arrancaron con un ADMIN phone-side como PRIMER mensaje —
    // el inbound original del cliente se había perdido. Baileys entrega
    // los mensajes que ocurrieron durante un disconnect como
    // `type: 'append'` (history sync). Con la semana de outages que
    // tuvimos (rc13 → rc14 + reconexiones del watchdog cada tanto),
    // varios inbounds cayeron en esa ventana y quedaron fuera. La
    // respuesta phone-side de Marcos, en cambio, llega como `notify`
    // fresh y ahí sí crea la conversación — de ahí el patrón que él
    // ve.
    //
    // Fix: procesar también 'append', pero SÓLO para mensajes de las
    // últimas WHATSAPP_QR_APPEND_MAX_AGE_MS (default 24h). El dedup
    // por waMessageId (ya presente en recordPhoneSideOutbound y en el
    // save via handleWhatsAppMessage) evita duplicados si Baileys
    // re-emite. Descartamos 'prepend'/'replace' — 'prepend' es la
    // carga inicial de historia enterísima (miles de mensajes viejos
    // que ya guardamos o que no necesitamos), 'replace' es edits que
    // no manejamos hoy.
    if (m.type !== 'notify' && m.type !== 'append') return;
    const maxAppendAgeMs = (() => {
      const raw = Number(process.env.WHATSAPP_QR_APPEND_MAX_AGE_MS);
      return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60 * 1000;
    })();
    const now = Date.now();
    for (const msg of m.messages) {
      if (m.type === 'append') {
        const ts = Number(msg.messageTimestamp);
        const ageMs = Number.isFinite(ts) && ts > 0 ? now - ts * 1000 : Infinity;
        if (ageMs > maxAppendAgeMs) continue;
      }
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
        // fromMe=true: pushName es del propio equipo, no del cliente.
        // La foto del contacto sí sirve — es del OTRO extremo.
        const avatarUrlOut = await this.fetchProfilePictureUrl(remoteJid);
        await this.conversationHandler.recordPhoneSideOutbound({
          to: from,
          text: text.trim(),
          jid: remoteJid,
          waMessageId: msg.key.id ?? `qr-${Date.now()}`,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          fallbackLookup,
          avatarUrl: avatarUrlOut,
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
        const pushNameMedia = (msg as any)?.pushName ?? null;
        const avatarUrlMedia = await this.fetchProfilePictureUrl(remoteJid);
        await this.conversationHandler.recordWhatsAppMediaInbound({
          from,
          jid: remoteJid,
          caption: text.trim(),
          waMessageId: msg.key.id ?? `qr-${Date.now()}`,
          timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          fallbackLookup,
          pushName: pushNameMedia,
          avatarUrl: avatarUrlMedia,
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
        // Marcos 2026-07-31: pushName (el "Mi nombre" del cliente en su
        // WhatsApp) y foto de perfil — reemplaza el placeholder "54"
        // del avatar por algo distinguible ni bien entra el primer msg.
        const pushName = (msg as any)?.pushName ?? null;
        const avatarUrl = await this.fetchProfilePictureUrl(remoteJid);
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
          pushName,
          avatarUrl,
        );
        // Marcos 2026-08-13 (WhatsApp 13:12 AR — caso "otra cosa" →
        // "Dale, preguntá" prematuro + par contradictorio sobre moldes):
        // los clientes escriben en 2-3 mensajes cortos seguidos. Antes,
        // cada mensaje disparaba una respuesta inmediata sin ver los
        // siguientes. Ahora la persistencia sigue siendo eager (siempre
        // llamamos al handler que guarda el mensaje en DB + dedup por
        // waMessageId + escalaciones L3 / mayorista / aiPaused), pero
        // el ENVÍO del reply al cliente se debounza: si otro mensaje
        // del mismo jid entra dentro de AGENT_MSG_DEBOUNCE_MS (default
        // 4s), la respuesta anterior se descarta y sólo sale la última.
        // Trade-off: pagamos ~1 llamada extra a Claude por ráfaga de
        // mensajes, pero el cliente ve una sola respuesta coherente
        // en lugar de dos contradictorias. Kill switch: AGENT_MSG_DEBOUNCE_MS=0
        const result = await this.conversationHandler.handleWhatsAppMessage(incoming);
        const waReviewMode =
          (process.env.WHATSAPP_AUTO_SEND_DISABLED ?? 'false').toLowerCase() === 'true';
        if (result.success && result.response && !waReviewMode) {
          this.scheduleDebouncedSend(remoteJid, from, result.response);
        } else if (result.success && result.response && waReviewMode) {
          this.logger.log(`⏸️  A3 modo revisión activo — borrador guardado, no se envía a ${from}`);
        }
      } catch (err: any) {
        this.logger.error(`handler invocation failed for ${from}: ${err?.message ?? err}`);
      }
    }
  }

  private pendingSendTimers: Map<string, { timer: NodeJS.Timeout; response: string }> = new Map();

  private scheduleDebouncedSend(remoteJid: string, from: string, response: string): void {
    const debounceMs = Number(process.env.AGENT_MSG_DEBOUNCE_MS ?? 4000);
    if (!Number.isFinite(debounceMs) || debounceMs <= 0) {
      void this.sendMessage(remoteJid, response);
      return;
    }
    const existing = this.pendingSendTimers.get(remoteJid);
    if (existing) {
      clearTimeout(existing.timer);
      this.logger.debug(`debounce: superseded pending reply for ${from} (older reply discarded)`);
    }
    const timer = setTimeout(() => {
      const pending = this.pendingSendTimers.get(remoteJid);
      this.pendingSendTimers.delete(remoteJid);
      if (!pending) return;
      void this.sendMessage(remoteJid, pending.response).catch((e) =>
        this.logger.error(`debounced send failed for ${from}: ${e?.message ?? e}`),
      );
    }, debounceMs);
    this.pendingSendTimers.set(remoteJid, { timer, response });
  }
}
