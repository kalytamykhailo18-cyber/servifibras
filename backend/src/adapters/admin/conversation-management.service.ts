/**
 * ADAPTERS LAYER - Conversation Management Service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, ConversationStatus, ContentType, MessageSender } from '@prisma/client';
import {
  IConversationManagementService,
  ConversationListFilter,
  ConversationDetails,
} from '../../use-cases/admin/conversation-management.interface';
import { UserRole } from '../../domain/entities/auth.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { UploadStorageService } from '../uploads/upload-storage.service';
import { FileShareService } from '../files/file-share.service';
import { WebchatService } from '../webchat/webchat.service';
import { SocialMediaService } from '../social/social-media.service';
import { WebchatOutgoingMessage, WebchatMessageType } from '../../domain/entities/webchat-message.entity';
import { WhatsAppOutgoingMessage } from '../../domain/entities/whatsapp-message.entity';
import {
  SocialOutgoingMessage,
  SocialPlatform,
  SocialMessageType,
} from '../../domain/entities/social-message.entity';
import { getMessageCipher } from '../security/message-cipher';

/**
 * Marcos 2026-08-03 (WhatsApp 8:16 AR): "yanina ve todas las
 * conversaciones de whatsapp, brenda y franco no". Yanina es ADMIN;
 * Brenda y Franco son ENCARGADO. El scoping trataba ENCARGADO como
 * VENTAS/LOGISTICA — sólo veían sus asignadas — cuando en realidad
 * ENCARGADO es rol de encargado/ops manager y necesita ver todo,
 * igual que ADMIN. Otros controllers (orders, logística) ya tratan a
 * ENCARGADO como elevated. Centralizamos acá para que no vuelva a
 * quedar afuera.
 */
function isFullScopeRole(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.ENCARGADO;
}

/** Read a non-negative integer from .env with a fallback. */
function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

@Injectable()
export class ConversationManagementService implements IConversationManagementService {
  private readonly logger = new Logger(ConversationManagementService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly uploads: UploadStorageService,
    private readonly fileShare: FileShareService,
    private readonly webchat: WebchatService,
    private readonly social: SocialMediaService,
  ) {
    this.prisma = new PrismaClient();
    this.logger.log('✅ Conversation Management service initialized');
  }

  async listConversations(filter: ConversationListFilter): Promise<{
    conversations: ConversationDetails[];
    total: number;
  }> {
    try {
      // Sandbox conversations live in the same tables as real ones but
      // are filtered out of every operator-facing list. The "Probar como
      // cliente" panel reads them through a separate endpoint.
      const where: any = { isSandbox: false };

      if (filter.channel) {
        where.channel = filter.channel;
      }

      if (filter.status) {
        where.status = filter.status;
      }

      if (filter.assignedToUserId) {
        where.assignedTo = filter.assignedToUserId;
      }

      // Marcos 2026-07-21: filtro para la tab "No leídos" del inbox
      // (símil WhatsApp). Cuando llega true, sólo devolvemos las que
      // realmente esperan respuesta del staff.
      //
      // Marcos 2026-08-10 (WhatsApp 11:27 AR): "no leidas sigue sin
      // funcionar" — a pesar del reconciler, seguía viendo 678 rows
      // colgadas, 154 de más de 30 días, casi todas contactos con
      // LID como nombre (orphans de la migración pre-pushName). Nadie
      // va a contestar mensajes de julio 5 semanas tarde. Aplicamos
      // el mismo horizonte de edad que ya usa el widget de Atención
      // (ATENCION_QUEUE_MAX_AGE_DAYS, default 14): pending escalado
      // hace más de N días no aparece en la vista "No leídas". La row
      // sigue en la DB con needsHumanAttention=true; sólo se oculta
      // del listado del día a día. Consistente con lo que hace la card
      // de Atención en Analítica. Kill switch: subir el env a 365.
      if (filter.needsHumanAttention === true) {
        // Marcos 2026-08-10 13:12 AR: "no leidos actualmente son 8"
        // (WhatsApp Web) vs 341 (CRM) — WA cuenta unread por receipts
        // del celular, el CRM antes contaba `needsHumanAttention` que
        // se disparaba por escalación aunque Marcos ya hubiera visto
        // el mensaje. Nueva columna hasUnreadCustomer: TRUE cuando
        // cliente escribe, FALSE cuando el equipo responde O cuando
        // Marcos abre el chat en el celular (via chats.update de
        // Baileys). Alinea 1:1 con la semántica de "no leído" de WA.
        where.hasUnreadCustomer = true;
        // Aún filtramos por edad como safety net por si el sync de
        // Baileys se atrasa — mantiene el orden natural del inbox.
        const inboxHours = num('INBOX_UNREAD_MAX_AGE_HOURS', 24);
        const inboxCutoff = new Date(Date.now() - inboxHours * 60 * 60 * 1000);
        where.lastMessageAt = { gte: inboxCutoff };
      }

      // Marcos 2026-07-21: filtro para la tab "Favoritas".
      if (filter.favorite === true) {
        where.favorite = true;
      }

      // Role-based scoping. Admins + Encargados ven todo; el resto ve
      // sólo su slice.
      //   ADMIN / ENCARGADO — sees everything (via isFullScopeRole)
      //   ATENCION — assigned to her OR unassigned (first-line queue)
      //   VENTAS / LOGISTICA — only conversations assigned to them
      // We compose role-scope and search as separate AND'd OR groups so a
      // search query doesn't accidentally widen Brenda's view past her queue.
      const ands: any[] = [];
      if (filter.scope && !isFullScopeRole(filter.scope.role)) {
        const me = filter.scope.userId;
        if (filter.scope.role === UserRole.ATENCION) {
          ands.push({ OR: [{ assignedTo: me }, { assignedTo: null }] });
        } else {
          where.assignedTo = me;
        }
      }

      if (filter.search) {
        const q = filter.search;
        // Full-text-ish search: contact name, last-message snippet, OR any
        // message body in the conversation. The `messages.some` query lets
        // Marcos find a thread by typing "epoxi" even if the term came up
        // weeks ago and isn't in `lastMessage` anymore.
        //
        // With encryption-at-rest ON, `messages.some.content.contains`
        // can't match ciphertext rows — the DB sees `enc:v1:<base64>...`
        // and the search term won't appear inside that. We keep the OR
        // for legacy plaintext rows that haven't been backfilled, then
        // run a second post-decrypt scan further down to recover the
        // ciphertext-row matches. lastMessage gets the same treatment.
        // Marcos 2026-07-10: sumado contact.phone al match. Mucha
        // conversación de mayorista arranca sin nombre — el chip del
        // inbox muestra el número crudo (ej. "5493513105082"). Al
        // buscar por número no matcheaba porque solo cruzábamos name,
        // lastMessage y messages.content. Ahora el número entra por
        // phone directo (y por name para los casos donde el número
        // quedó grabado como nombre — WhatsApp inbound sin perfil).
        //
        // Marcos 2026-08-04: sumado un segundo predicate sobre phone
        // usando el query normalizado (sólo dígitos). Cuando el
        // operador pega el número desde WhatsApp Web sale
        // "+54 9 11 6636-4558", con espacios y guiones — el
        // `contains` original no matcheaba "5491166364558". Si `q`
        // contiene al menos 4 dígitos, agregamos el OR con la
        // versión digits-only.
        const digitsOnly = q.replace(/\D/g, '');
        const orClauses: any[] = [
          { contact: { name: { contains: q, mode: 'insensitive' } } },
          { contact: { phone: { contains: q } } },
          { lastMessage: { contains: q, mode: 'insensitive' } },
          { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
        ];
        if (digitsOnly.length >= 4 && digitsOnly !== q) {
          orClauses.push({ contact: { phone: { contains: digitsOnly } } });
        }
        ands.push({ OR: orClauses });
      }
      if (ands.length > 0) {
        where.AND = ands;
      }

      const limit = filter.limit || 50;
      const offset = filter.offset || 0;

      // Marcos 2026-07-06 PM: mayoristas arriba del inbox.
      // Un mayorista se define por contact.type='MAYORISTA'
      // (taxonomía legacy) O contact.customerType='MAYORISTA' (la
      // nueva de 6 valores). Cualquiera de las dos hace que la
      // conversación flote al tope. Para la primera página (offset=0)
      // fetch los mayoristas separados y los prepende; para páginas
      // siguientes cae al orden recency estándar.
      const mayoristaContactFilter = {
        OR: [
          { type: 'MAYORISTA' as const },
          { customerType: 'MAYORISTA' as const },
        ],
      };
      const includeShape = {
        contact: true,
        assigned: true,
        messages: {
          orderBy: { timestamp: 'desc' as const },
          take: 1,
        },
        _count: {
          select: { messages: true },
        },
      };
      // Marcos 2026-08-03 (WhatsApp 11:04 AR): "actualmente está
      // posicionando arriba los más nuevos. Pero tenemos que aplicar
      // la lógica de que posiciona arriba los más urgentes de atención
      // (mayoristas, cliente recurrente, y conversaciones que lleven
      // más tiempo esperando)". Volvemos a ordering compuesto por
      // urgencia — pero de manera correcta esta vez:
      //
      //   1) TODOS los pendientes (needsHumanAttention=true) van
      //      arriba, sin importar recency.
      //   2) Dentro del bloque pendiente: MAYORISTA primero, luego
      //      cliente recurrente (funnelStage FRECUENTE|COMPRADOR),
      //      luego el resto. En cada tie, el que lleva más tiempo
      //      esperando (lastMessageAt ASC) va primero.
      //   3) No-pendientes ordenados por recencia (lastMessageAt
      //      DESC) — comportamiento clásico de app de chat.
      //
      // Implementación: dos fetches en paralelo. Un fetch único con
      // orderBy pending-first + limit 500 dejaba fuera a los
      // pendientes MÁS VIEJOS — que son justo los "que llevan más
      // tiempo esperando" que Marcos quiere ver arriba.
      //
      // Historia:
      //   * 07-13 W1: pending-first + prioridad mayorista.
      //   * 07-24: revertido a recency pura porque con ~328 pending
      //     el top-40 de "Todas" quedaba visualmente igual a
      //     "No leídas" ("no hay diferencias, todo figura igual").
      //   * 08-03 (este): Marcos ahora sí pide pending-first, pero
      //     con ordering fino de urgencia dentro del bloque. "Todas"
      //     vs "No leídas" siguen diferenciándose: "No leídas" filtra
      //     en el WHERE al bucket pending; "Todas" mezcla pending
      //     (arriba) + no-pending (abajo, siempre visible aunque
      //     haya muchos pending gracias al split-fetch).
      const RECURRING_STAGES = new Set(['FRECUENTE', 'COMPRADOR']);
      const urgencyCmp = (a: any, b: any): number => {
        const aMay = a.contact?.customerType === 'MAYORISTA' ? 1 : 0;
        const bMay = b.contact?.customerType === 'MAYORISTA' ? 1 : 0;
        if (aMay !== bMay) return bMay - aMay;
        const aRec = RECURRING_STAGES.has(a.contact?.funnelStage ?? '') ? 1 : 0;
        const bRec = RECURRING_STAGES.has(b.contact?.funnelStage ?? '') ? 1 : 0;
        if (aRec !== bRec) return bRec - aRec;
        // Longest waiting first: oldest lastMessageAt goes to top.
        const tA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : Infinity;
        const tB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : Infinity;
        return tA - tB;
      };

      const onlyPending = filter.needsHumanAttention === true;
      const onlyNonPending = filter.needsHumanAttention === false;
      const pendingPoolCap = num('CONVERSATION_URGENCY_POOL_CAP', 1000);

      // eslint-disable-next-line prefer-const
      let [pendingPool, total] = await Promise.all([
        onlyNonPending
          ? Promise.resolve([] as any[])
          : this.prisma.conversation.findMany({
              where: { ...where, needsHumanAttention: true },
              include: includeShape,
              // Traemos hasta pendingPoolCap. Ordenamos por
              // lastMessageAt ASC para que si el pool se satura,
              // preserve a los más viejos (los que Marcos quiere
              // arriba). El re-sort en JS aplica el ordering
              // compuesto de urgencia dentro del pool.
              orderBy: [{ lastMessageAt: { sort: 'asc' as const, nulls: 'last' as const } }],
              take: pendingPoolCap,
            }),
        this.prisma.conversation.count({ where }),
      ]);
      const sortedPending = (pendingPool as any[]).slice().sort(urgencyCmp);
      const pendingSlice = sortedPending.slice(offset, offset + limit);
      let conversations: any[] = pendingSlice;

      if (!onlyPending && conversations.length < limit) {
        const remaining = limit - conversations.length;
        // Si offset cae dentro del pool pendiente, la slice de arriba
        // ya lo sirvió. Si lo supera, saltamos al non-pending
        // correspondiente.
        const nonPendingSkip = Math.max(0, offset - sortedPending.length);
        const nonPending = await this.prisma.conversation.findMany({
          where: { ...where, needsHumanAttention: false },
          include: includeShape,
          orderBy: [
            { lastMessageAt: { sort: 'desc' as const, nulls: 'last' as const } },
            { updatedAt: 'desc' as const },
          ],
          take: remaining,
          skip: nonPendingSkip,
        });
        conversations = [...conversations, ...nonPending];
      }

      // Post-decrypt scan to recover ciphertext-row search matches that
      // the DB query couldn't see. Only runs when (a) encryption is
      // turned on and (b) the operator typed a search term. We pull a
      // bounded candidate set ordered by recency and decrypt the most
      // recent N messages per conversation. This trades some CPU for
      // search correctness — Marcos's brief was "find the thread by what
      // the customer said weeks ago", which we can't honor any other way
      // once the column is encrypted.
      // Marcos 2026-07-13 (W1 del documento, item búsqueda cifrada):
      // antes esta pasada corría SOLO en la primer página (offset===0)
      // — si Marcos scrolleaba, el ciphertext no se cruzaba más. Ahora
      // corre en todas las páginas; el haystackCap sigue acotando el
      // costo por request. La siguiente iteración es agregar una
      // columna "searchText" normalizada + índice GIN para no
      // depender del post-decrypt en línea, pero eso implica una
      // migración con backfill que va como tarea aparte.
      if (filter.search && getMessageCipher().isEnabled()) {
        const haystackCap = num('CONVERSATION_SEARCH_DECRYPT_CANDIDATES', 500);
        const perConvMessages = num('CONVERSATION_SEARCH_DECRYPT_DEPTH', 50);
        const q = filter.search.toLowerCase();
        const seen = new Set(conversations.map((c) => c.id));

        // Reuse the role-scope filter (drop the search-OR group so the
        // scan can see encrypted rows that the DB query rejected).
        const scanWhere: any = { isSandbox: false };
        if (filter.channel)          scanWhere.channel = filter.channel;
        if (filter.status)           scanWhere.status = filter.status;
        if (filter.assignedToUserId) scanWhere.assignedTo = filter.assignedToUserId;
        if (filter.scope && !isFullScopeRole(filter.scope.role)) {
          if (filter.scope.role === UserRole.ATENCION) {
            scanWhere.OR = [{ assignedTo: filter.scope.userId }, { assignedTo: null }];
          } else {
            scanWhere.assignedTo = filter.scope.userId;
          }
        }

        // Candidate scan ordering: pure recency. The user-facing list
        // floats flagged convs to the top (above), but the post-decrypt
        // scan needs to see RECENT convs regardless of flag — once the
        // flagged-count crosses haystackCap (~500), a needsHumanAttention
        // DESC primary sort starves recent unflagged convs out of the
        // candidate set and the search silently misses them. 2026-06-04:
        // flagged count crossed 505, surfaced by encryption-search probe.
        const candidates = await this.prisma.conversation.findMany({
          where: scanWhere,
          include: {
            contact: true,
            assigned: true,
            messages: {
              orderBy: { timestamp: 'desc' },
              take: perConvMessages,
            },
            _count: { select: { messages: true } },
          },
          orderBy: [
            { needsHumanAttention: 'desc' },
            { lastMessageAt: { sort: 'desc', nulls: 'last' } },
            { updatedAt: 'desc' },
          ],
          take: haystackCap,
        });

        const cipher = getMessageCipher();
        const matched: typeof conversations = [];
        for (const cand of candidates) {
          if (seen.has(cand.id)) continue;
          // contact.name + lastMessage already had a shot at the DB
          // level for plaintext; here we re-check after decrypt for
          // ciphertext rows.
          const name = (cand.contact?.name ?? '').toLowerCase();
          const last = cipher.decrypt(cand.lastMessage ?? '').toLowerCase();
          let hit = name.includes(q) || last.includes(q);
          if (!hit) {
            for (const m of cand.messages) {
              if (cipher.decrypt(m.content).toLowerCase().includes(q)) {
                hit = true;
                break;
              }
            }
          }
          if (hit) {
            // Trim back the messages bag to the single-message preview the
            // outer mapper expects; we only loaded the deeper slice for
            // scanning.
            (cand as any).messages = cand.messages.slice(0, 1);
            matched.push(cand as any);
            seen.add(cand.id);
            if (conversations.length + matched.length >= limit) break;
          }
        }
        if (matched.length > 0) {
          conversations = [...conversations, ...matched]
            .sort((a, b) => {
              if (a.needsHumanAttention !== b.needsHumanAttention) {
                return a.needsHumanAttention ? -1 : 1;
              }
              // Espeja el orden del DB: lastMessageAt (nulls al final),
              // updatedAt como tiebreak.
              const aMs = a.lastMessageAt?.getTime() ?? -1;
              const bMs = b.lastMessageAt?.getTime() ?? -1;
              if (aMs !== bMs) return bMs - aMs;
              return b.updatedAt.getTime() - a.updatedAt.getTime();
            })
            .slice(0, limit);
          total += matched.length;
        }
      }

      const cipher = getMessageCipher();
      const conversationDetails: ConversationDetails[] = conversations.map((conv) => ({
        id: conv.id,
        contact: {
          id: conv.contact.id,
          name: conv.contact.name,
          phone: conv.contact.phone,
          email: conv.contact.email,
          channel: conv.contact.channel,
          avatarUrl: conv.contact.avatarUrl,
          // Marcos 2026-07-06 PM: la fila del inbox necesita saber si el
          // contacto es MAYORISTA para (a) renderizar el chip visible y
          // (b) validar el ordenamiento del backend. Ambos campos van —
          // `type` es la taxonomía legacy y `customerType` es la nueva
          // de 6 valores; con cualquiera que sea MAYORISTA alcanza para
          // que el frontend pinte la fila con el badge.
          type: conv.contact.type,
          customerType: conv.contact.customerType,
        },
        channel: conv.channel,
        status: conv.status,
        assignedTo: conv.assigned
          ? {
              id: conv.assigned.id,
              name: conv.assigned.name,
            }
          : null,
        // lastMessage is encrypted on disk; decrypt for the inbox preview.
        lastMessage: cipher.decrypt(conv.lastMessage ?? ''),
        // Marcos 2026-07-13: sin devolver este campo el frontend no
        // puede calcular el "hace X" y muestra "Sin mensajes" para
        // toda la fila (mismo valor que renderiza cuando lastMessageAt
        // es null). Se ve peor de lo que está: la conversación tiene
        // mensajes reales pero visualmente parece vacía.
        lastMessageAt: conv.lastMessageAt,
        messageCount: conv._count.messages,
        needsHumanAttention: conv.needsHumanAttention,
        escalatedAt: conv.escalatedAt,
        favorite: (conv as any).favorite ?? false,
        favoritedAt: (conv as any).favoritedAt ?? null,
        aiPaused: conv.aiPaused,
        aiPausedAt: conv.aiPausedAt,
        aiPausedBy: conv.aiPausedBy,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: [], // Messages loaded separately in getConversationById
      }));

      return {
        conversations: conversationDetails,
        total,
      };
    } catch (error: any) {
      this.logger.error(`Error listing conversations: ${error.message}`);
      return { conversations: [], total: 0 };
    }
  }

  async getConversationById(
    conversationId: string,
    scope?: { userId: string; role: UserRole },
  ): Promise<ConversationDetails | null> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          contact: true,
          assigned: true,
          messages: {
            orderBy: { timestamp: 'asc' },
            include: {
              // Per-user attribution: who actually clicked Send. Null
              // for CUSTOMER + AI messages — those identify themselves
              // by the `sender` enum.
              author: { select: { id: true, name: true } },
            },
          },
          _count: {
            select: { messages: true },
          },
        },
      });

      if (!conversation) {
        return null;
      }

      // Per-record scope check. List-level scoping already filters what the
      // user sees in their inbox; we mirror it here so a deep-link to a
      // conversation outside that scope returns 404 instead of leaking.
      //   ADMIN / ENCARGADO — sees all
      //   ATENCION — own + unassigned (Brenda's first-line queue)
      //   VENTAS / LOGISTICA — own only
      if (scope && !isFullScopeRole(scope.role)) {
        const ownsRecord = conversation.assignedTo === scope.userId;
        const unassigned = conversation.assignedTo === null;
        const allowed =
          scope.role === UserRole.ATENCION ? (ownsRecord || unassigned) : ownsRecord;
        if (!allowed) {
          this.logger.debug(
            `Conversation ${conversationId} hidden from ${scope.role} ${scope.userId} (out of scope)`,
          );
          return null;
        }
      }

      return {
        id: conversation.id,
        contact: {
          id: conversation.contact.id,
          name: conversation.contact.name,
          phone: conversation.contact.phone,
          email: conversation.contact.email,
          channel: conversation.contact.channel,
          avatarUrl: conversation.contact.avatarUrl,
          type: conversation.contact.type,
          customerType: conversation.contact.customerType,
        },
        channel: conversation.channel,
        status: conversation.status,
        assignedTo: conversation.assigned
          ? {
              id: conversation.assigned.id,
              name: conversation.assigned.name,
            }
          : null,
        // Decrypt the denormalized last-message preview AND every message
        // body before returning. Cipher returns plaintext as-is for any
        // legacy rows that pre-date encryption.
        lastMessage: getMessageCipher().decrypt(conversation.lastMessage ?? ''),
        lastMessageAt: conversation.lastMessageAt,
        messageCount: conversation._count.messages,
        needsHumanAttention: conversation.needsHumanAttention,
        escalatedAt: conversation.escalatedAt,
        favorite: (conversation as any).favorite ?? false,
        favoritedAt: (conversation as any).favoritedAt ?? null,
        aiPaused: conversation.aiPaused,
        aiPausedAt: conversation.aiPausedAt,
        aiPausedBy: conversation.aiPausedBy,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: (() => {
          const cipher = getMessageCipher();
          return conversation.messages.map((msg) => ({
            id: msg.id,
            content: cipher.decrypt(msg.content),
            sender: msg.sender,
            contentType: msg.contentType,
            isFromAI: msg.isFromAI,
            timestamp: msg.timestamp,
            attachmentUrl: msg.attachmentUrl,
            attachmentName: msg.attachmentName,
            attachmentMime: msg.attachmentMime,
            attachmentSize: msg.attachmentSize,
            author: msg.author ? { id: msg.author.id, name: msg.author.name } : null,
          }));
        })(),
      };
    } catch (error: any) {
      this.logger.error(`Error getting conversation: ${error.message}`);
      return null;
    }
  }

  /**
   * Render a conversation as a PDF buffer suitable for legal retention,
   * defensa-al-consumidor responses, and dispute archives.
   *
   * Internal notes are merged into the same timeline so the export
   * matches what the operator saw in the panel — but with a clear
   * "Nota interna" label so anyone reading the file understands those
   * lines were never sent to the customer.
   */
  async renderPdf(conversationId: string): Promise<Buffer | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: true,
        messages: { orderBy: { timestamp: 'asc' } },
        internalNotes: { include: { author: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv) return null;
    // Lazy-load so the builder file isn't pulled in for non-PDF callers.
    const { buildConversationPdf } = await import('./conversation-pdf.builder');
    const cipher = getMessageCipher();
    return buildConversationPdf({
      id: conv.id,
      channel: String(conv.channel),
      status: String(conv.status),
      createdAt: conv.createdAt,
      contact: {
        name: conv.contact?.name ?? null,
        phone: conv.contact?.phone ?? null,
        email: conv.contact?.email ?? null,
      },
      messages: conv.messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        isFromAI: m.isFromAI,
        // Decrypt before rendering into the PDF so the operator-visible
        // export shows real content, not ciphertext.
        content: cipher.decrypt(m.content),
        timestamp: m.timestamp,
      })),
      internalNotes: conv.internalNotes.map((n) => ({
        id: n.id,
        authorName: n.author?.name ?? 'Sistema',
        content: cipher.decrypt(n.content),
        createdAt: n.createdAt,
      })),
    });
  }

  async assignConversation(conversationId: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          assignedTo: userId,
          status: ConversationStatus.ACTIVE,
        },
      });

      this.logger.log(`✅ Conversation ${conversationId} assigned to user ${userId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error assigning conversation: ${error.message}`);
      return false;
    }
  }

  async updateConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<boolean> {
    try {
      const before = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { status: true },
      });
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status },
      });

      this.logger.log(`✅ Conversation ${conversationId} status updated to ${status}`);

      // Fire-and-forget quality scoring on first transition to CLOSED.
      // The scorer + pattern detector are injected lazily via the
      // `closedHook` setter so this service stays free of the AI module
      // dependency. Errors inside the hook are swallowed by the hook itself.
      if (
        status === ConversationStatus.CLOSED &&
        before?.status !== ConversationStatus.CLOSED &&
        this.closedHook
      ) {
        void this.closedHook(conversationId);
      }
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating conversation status: ${error.message}`);
      return false;
    }
  }

  /** Optional listener for "conversation closed" events. The Quality
   *  module wires this up at boot via `setOnClosed()` so closing a
   *  conversation triggers Claude scoring without this adapter taking
   *  a hard dep on the AI layer. */
  private closedHook: ((conversationId: string) => void | Promise<void>) | null = null;
  setOnClosed(hook: (conversationId: string) => void | Promise<void>): void {
    this.closedHook = hook;
  }

  /** Optional listener for "operator/AI reply sent" events. Wired by
   *  the admin module (same pattern as the closed hook) so the live
   *  quality-score panel can re-evaluate the conversation as the
   *  operator replies, without this service hard-depending on the
   *  scorer. */
  private replyHook: ((conversationId: string) => void) | null = null;
  setOnReply(hook: (conversationId: string) => void): void {
    this.replyHook = hook;
  }

  /**
   * Pause or resume the AI on a single conversation. When paused, the
   * `ConversationHandlerService` will save inbound messages but won't
   * generate AI replies — humans must respond from the panel. Used when
   * Marcos's team spots the AI making mistakes and needs to take over.
   *
   * Returns the freshly-updated conversation so the caller can broadcast
   * the new state over Socket.io to other connected operators.
   */
  async setAiPaused(
    conversationId: string,
    paused: boolean,
    actorUserId: string,
  ): Promise<{ id: string; aiPaused: boolean; aiPausedAt: Date | null; aiPausedBy: string | null } | null> {
    try {
      const updated = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: paused
          ? { aiPaused: true,  aiPausedAt: new Date(), aiPausedBy: actorUserId }
          : { aiPaused: false, aiPausedAt: null,        aiPausedBy: null },
        select: { id: true, aiPaused: true, aiPausedAt: true, aiPausedBy: true },
      });
      this.logger.log(
        `${paused ? '⏸️  AI paused' : '▶️  AI resumed'} on ${conversationId} by ${actorUserId}`,
      );
      return updated;
    } catch (err: any) {
      this.logger.error(`setAiPaused failed: ${err.message}`);
      return null;
    }
  }

  async transferConversation(args: {
    conversationId: string;
    fromUserId: string;
    toUserId: string;
    note?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    note: { id: string; content: string; createdAt: Date; authorId: string } | null;
  }> {
    const { conversationId, fromUserId, toUserId, note } = args;
    try {
      // Pre-flight validation. Catches the common slipups before we touch
      // Prisma so the failure mode is one structured response, not a
      // partially-applied transaction.
      if (toUserId === fromUserId) {
        return { success: false, error: 'No se puede transferir a uno mismo', note: null };
      }
      const target = await this.prisma.user.findUnique({
        where: { id: toUserId },
        select: { id: true, active: true, role: true },
      });
      if (!target) {
        return { success: false, error: 'Usuario destino no encontrado', note: null };
      }
      if (!target.active) {
        return { success: false, error: 'No se puede transferir a un usuario desactivado', note: null };
      }

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            assignedTo: toUserId,
            status: ConversationStatus.ACTIVE,
          },
        });
        if (note && note.trim().length > 0) {
          const created = await tx.internalNote.create({
            data: {
              conversationId,
              authorId: fromUserId,
              content: getMessageCipher().encrypt(note.trim()),
            },
          });
          return created;
        }
        return null;
      });

      this.logger.log(
        `✅ Conversation ${conversationId} transferred ${fromUserId} → ${toUserId}${result ? ' (with note)' : ''}`,
      );
      return {
        success: true,
        note: result
          ? {
              id: result.id,
              // Decrypt before handing back to the controller — the caller
              // surfaces the note in a Sonner toast for the receiving user.
              content: getMessageCipher().decrypt(result.content),
              createdAt: result.createdAt,
              authorId: result.authorId,
            }
          : null,
      };
    } catch (error: any) {
      this.logger.error(`Error transferring conversation: ${error.message}`);
      return { success: false, note: null };
    }
  }

  async listInternalNotes(conversationId: string) {
    const rows = await this.prisma.internalNote.findMany({
      where: { conversationId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const cipher = getMessageCipher();
    return rows.map((n) => ({
      id: n.id,
      conversationId: n.conversationId,
      authorId: n.authorId,
      authorName: n.author.name,
      content: cipher.decrypt(n.content),
      createdAt: n.createdAt,
    }));
  }

  /**
   * Save an operator-sent message that includes a file attachment. The file
   * itself is stored by `UploadStorageService` before this is called; here
   * we just persist the URL/mime/size on the Message row.
   *
   * The optional `caption` is the text portion (WhatsApp lets you caption a
   * media message). Empty string when none.
   *
   * Returns the created message id, or null on failure.
   */
  async sendManualAttachment(args: {
    conversationId: string;
    userId: string;
    caption: string;
    attachmentUrl: string;
    attachmentName: string;
    attachmentMime: string;
    attachmentSize: number;
    contentType: ContentType;
  }): Promise<{ id: string; timestamp: Date } | null> {
    try {
      const cipher = getMessageCipher();
      const encryptedCaption = cipher.encrypt(args.caption);
      const msg = await this.prisma.message.create({
        data: {
          conversationId: args.conversationId,
          sender: MessageSender.ADMIN,
          content: encryptedCaption,
          contentType: args.contentType,
          isFromAI: false,
          attachmentUrl: args.attachmentUrl,
          attachmentName: args.attachmentName,
          attachmentMime: args.attachmentMime,
          attachmentSize: args.attachmentSize,
          // Same per-user attribution as text replies — staff
          // attachments should also carry "who sent it" so the
          // transcript can show the operator's actual name.
          authorId: args.userId,
        },
        select: { id: true, timestamp: true },
      });

      // Same conversation-state side-effects as a manual text message:
      // claim the conversation for this operator and clear any
      // "needs human" flag. The denormalized lastMessage column is
      // also encrypted so we don't leak it via the inbox preview.
      await this.prisma.conversation.update({
        where: { id: args.conversationId },
        data: {
          lastMessage: cipher.encrypt(
            args.caption || `[${args.contentType.toLowerCase()}] ${args.attachmentName}`,
          ),
          lastMessageAt: new Date(),
          assignedTo: args.userId,
          status: ConversationStatus.ACTIVE,
          needsHumanAttention: false,
          hasUnreadCustomer: false, // staff outbound clears WA-style unread
        },
      });

      this.logger.log(
        `📎 Attachment sent in conversation ${args.conversationId} (${args.contentType} ${args.attachmentSize}B)`,
      );

      // Fire-and-forget delivery to the live channel. WhatsApp is the only
      // channel where outbound media is wired today; FB/IG/ML/TiendaNube
      // need their own send paths and are no-ops for now (the message is
      // saved either way so the operator's UI stays consistent).
      // Marcos 2026-08-04: pasamos msg.id para que el delivery, cuando
      // haya éxito por Baileys, pueda stampear waMessageId en la fila
      // (mismo mecanismo que sendManualMessage). Sin esto, el echo del
      // outbound crea un contacto duplicado con phone=LID digits.
      void this.deliverAttachmentToChannel({ ...args, messageRowId: msg.id }).catch((err) =>
        this.logger.error(`Channel delivery failed for ${msg.id}: ${err?.message ?? err}`),
      );

      return msg;
    } catch (err: any) {
      this.logger.error(`Error sending attachment: ${err.message}`);
      return null;
    }
  }

  /**
   * Resolve the live channel for the conversation and forward the just-saved
   * attachment to the customer.
   *
   * Per channel:
   *   • WHATSAPP — native media via Meta Cloud API. Voice notes specifically
   *     must hit the audio path with `voice:true` so the customer sees a
   *     native voice-note bubble instead of a generic file attachment —
   *     that distinction is what Marcos called out as eroding trust on
   *     prometheo's outbound.
   *   • TIENDANUBE_WEBCHAT / FACEBOOK / INSTAGRAM — those provider APIs
   *     don't accept binary uploads from us today, so we mint a short-lived
   *     HMAC-signed download link via FileShareService and send it as a
   *     plain text message. Customer clicks the link and pulls the file
   *     from /p/file/<token>.
   *   • MERCADOLIBRE — ML doesn't allow proactive DMs at all (only
   *     answers to questions); we save the message locally and skip.
   *
   * Errors here never propagate to the caller — the message is already
   * persisted; the operator UI shouldn't fail because Meta is briefly down.
   */
  private async deliverAttachmentToChannel(args: {
    conversationId: string;
    attachmentUrl: string;
    attachmentName: string;
    attachmentMime: string;
    contentType: ContentType;
    caption: string;
    messageRowId?: string;
  }): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: {
        channel: true,
        contact: { select: { phone: true, metadata: true } },
      },
    });
    if (!conv) return;

    // attachmentUrl is `/admin/uploads/<relative>`; strip the prefix so
    // resolveSafe can map it back to the absolute path under UPLOADS_DIR.
    const PREFIX = '/admin/uploads/';
    const relative = args.attachmentUrl.startsWith(PREFIX)
      ? args.attachmentUrl.slice(PREFIX.length)
      : args.attachmentUrl;

    if (conv.channel === Channel.WHATSAPP) {
      const phone = conv.contact?.phone;
      if (!phone) {
        this.logger.warn(`Skip outbound media: contact has no phone for conv ${args.conversationId}`);
        return;
      }
      const resolved = this.uploads.resolveSafe(relative);
      if (!resolved) {
        this.logger.warn(`Skip outbound media: cannot resolve ${args.attachmentUrl}`);
        return;
      }
      const result = await this.whatsapp.sendMedia({
        to: phone,
        filePath: resolved.absolute,
        filename: args.attachmentName,
        mime: args.attachmentMime,
        contentType: args.contentType,
        caption: args.caption,
      });
      if (!result.success) {
        this.logger.warn(`WhatsApp media send returned failure: ${result.error}`);
      } else if (result.messageId && args.messageRowId) {
        // Ver comentario en sendManualMessage — mismo mecanismo para
        // que el echo Baileys del media outbound no cree un contacto
        // LID duplicado.
        await this.prisma.message.update({
          where: { id: args.messageRowId },
          data: { metadata: { waMessageId: result.messageId, source: 'crm-outbound' } },
        }).catch((e) => this.logger.warn(`Stamp waMessageId (media) failed: ${e?.message ?? e}`));
      }
      return;
    }

    // For non-WhatsApp channels, fall back to a text message with a public
    // signed download link. Composed body keeps the operator's caption (if
    // any) on top, then the file label, then the URL — that's the shape
    // customers parse fastest in TN webchat / FB DM bubbles.
    let link;
    try {
      link = this.fileShare.sign(relative, args.attachmentName);
    } catch (err: any) {
      this.logger.error(`File-share sign failed for ${args.conversationId}: ${err.message}`);
      return;
    }
    const caption = (args.caption ?? '').trim();
    const body = caption.length > 0
      ? `${caption}\n\n📎 ${args.attachmentName}\n${link.url}`
      : `📎 ${args.attachmentName}\n${link.url}`;

    if (conv.channel === Channel.TIENDANUBE_WEBCHAT) {
      const r = await this.webchat.sendMessage(
        new WebchatOutgoingMessage(args.conversationId, body, WebchatMessageType.TEXT),
      );
      if (!r.success) {
        this.logger.warn(`Webchat link-send failed for ${args.conversationId}: ${r.error}`);
      }
      return;
    }

    if (conv.channel === Channel.FACEBOOK || conv.channel === Channel.INSTAGRAM) {
      const md = (conv.contact?.metadata as Record<string, any>) ?? {};
      const senderId = md.facebookSenderId ?? md.instagramSenderId ?? md.socialSenderId;
      if (!senderId) {
        this.logger.warn(`Skip social link-send: no senderId on contact for conv ${args.conversationId}`);
        return;
      }
      const platform = conv.channel === Channel.FACEBOOK ? SocialPlatform.FACEBOOK : SocialPlatform.INSTAGRAM;
      const r = await this.social.sendMessage(
        new SocialOutgoingMessage(platform, SocialMessageType.DIRECT_MESSAGE, senderId, body),
      );
      if (!r.success) {
        this.logger.warn(`Social link-send failed for ${args.conversationId}: ${r.error}`);
      }
      return;
    }

    if (conv.channel === Channel.MERCADOLIBRE) {
      this.logger.log(`Skip outbound for ML conv ${args.conversationId}: provider doesn't support proactive DMs`);
      return;
    }
  }

  async sendManualMessage(
    conversationId: string,
    userId: string,
    content: string,
  ): Promise<{
    id: string;
    sender: MessageSender;
    content: string;
    contentType: any;
    isFromAI: boolean;
    timestamp: Date;
    attachmentUrl: string | null;
    attachmentName: string | null;
    attachmentMime: string | null;
    attachmentSize: number | null;
    author: { id: string; name: string } | null;
  } | null> {
    try {
      // Create message from human agent. `sender` enum stays role-based
      // for legacy code paths, but `authorId` carries the exact user so
      // the conversation transcript can show "Marcos" vs "Brenda
      // García" instead of collapsing every staff reply to "ADMIN".
      const cipher = getMessageCipher();
      const cipherText = cipher.encrypt(content);
      const created = await this.prisma.message.create({
        data: {
          conversationId,
          sender: MessageSender.ADMIN,
          content: cipherText,
          isFromAI: false,
          authorId: userId,
        },
        include: { author: { select: { id: true, name: true } } },
      });

      // Update conversation. A human reply also clears the "needs human"
      // flag — that's exactly the point at which the conversation is no
      // longer parked waiting for someone.
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessage: cipherText,
          lastMessageAt: new Date(),
          assignedTo: userId,
          status: ConversationStatus.ACTIVE,
          needsHumanAttention: false,
          hasUnreadCustomer: false, // staff manual reply clears WA-style unread
        },
      });

      this.logger.log(`✅ Manual message saved for conversation ${conversationId}`);

      // Marcos 2026-07-04: hasta hoy este método SÓLO guardaba en DB
      // — no había código que empujara el texto al canal del cliente.
      // El "replyHook" opcional nunca fue seteado por nadie. Como
      // consecuencia toda respuesta manual desde el CRM era fantasma:
      // aparecía en la conversación pero el cliente jamás la recibía.
      // Marcos flagged esto el 2026-07-03 apenas conectamos el número
      // real ("no salen del CRM"). El fix es despachar por el provider
      // que corresponda según canal. Errores de envío se loguean pero
      // NO tiran la respuesta del endpoint — la fila del mensaje queda
      // en el CRM con el warning en journalctl para diagnóstico.
      try {
        const conv = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: {
            channel: true,
            contact: { select: { phone: true, metadata: true } },
          },
        });
        if (conv) {
          if (conv.channel === Channel.WHATSAPP && conv.contact?.phone) {
            const r = await this.whatsapp.sendMessage(
              new WhatsAppOutgoingMessage(conv.contact.phone, content),
            );
            if (!r.success) {
              this.logger.warn(`WhatsApp manual send failed for ${conversationId}: ${r.error}`);
            } else if (r.messageId) {
              // Marcos 2026-08-04: stampear el waMessageId de Baileys
              // en la fila recién creada. Cuando Baileys eventualmente
              // dispare messages.upsert con fromMe=true para NUESTRO
              // propio outbound (echo del envío CRM), recordPhoneSide
              // Outbound busca por waMessageId — si lo encuentra hace
              // no-op y evita crear un contacto duplicado con phone=LID
              // digits (que era lo que Marcos veía como Luján + row
              // "268117662019706" el 08-04).
              await this.prisma.message.update({
                where: { id: created.id },
                data: { metadata: { waMessageId: r.messageId, source: 'crm-outbound' } },
              }).catch((e) => this.logger.warn(`Stamp waMessageId failed: ${e?.message ?? e}`));
            }
          } else if (conv.channel === Channel.TIENDANUBE_WEBCHAT) {
            const r = await this.webchat.sendMessage(
              new WebchatOutgoingMessage(conversationId, content, WebchatMessageType.TEXT),
            );
            if (!r.success) {
              this.logger.warn(`Webchat manual send failed for ${conversationId}: ${r.error}`);
            }
          } else if (
            conv.channel === Channel.FACEBOOK ||
            conv.channel === Channel.INSTAGRAM
          ) {
            const md = (conv.contact?.metadata as Record<string, any>) ?? {};
            const senderId = md.facebookSenderId ?? md.instagramSenderId ?? md.socialSenderId;
            if (!senderId) {
              this.logger.warn(`Skip social manual send: no senderId on contact for conv ${conversationId}`);
            } else {
              const platform =
                conv.channel === Channel.FACEBOOK ? SocialPlatform.FACEBOOK : SocialPlatform.INSTAGRAM;
              const r = await this.social.sendMessage(
                new SocialOutgoingMessage(platform, SocialMessageType.DIRECT_MESSAGE, senderId, content),
              );
              if (!r.success) {
                this.logger.warn(`Social manual send failed for ${conversationId}: ${r.error}`);
              }
            }
          } else if (conv.channel === Channel.MERCADOLIBRE) {
            // ML no soporta DMs proactivos — la conversación existe
            // sólo si el buyer inició, y las respuestas van por otro
            // canal (postventa / claims). Skip silencioso.
            this.logger.debug(`Skip ML manual outbound for conv ${conversationId} (provider limitation)`);
          }
        }
      } catch (sendErr: any) {
        this.logger.warn(`Channel dispatch failed for ${conversationId}: ${sendErr?.message ?? sendErr}`);
      }

      if (this.replyHook) {
        try {
          this.replyHook(conversationId);
        } catch {
          // hook errors must not break the reply path
        }
      }
      // Return the saved message in the same shape the conversation
      // projection uses, so the frontend can drop it in place of the
      // optimistic temp-row instead of refetching the whole thread (the
      // refetch caused a visible flash + scroll jump on send).
      return {
        id: created.id,
        sender: created.sender,
        content,
        contentType: created.contentType,
        isFromAI: created.isFromAI,
        timestamp: created.timestamp,
        attachmentUrl: created.attachmentUrl,
        attachmentName: created.attachmentName,
        attachmentMime: created.attachmentMime,
        attachmentSize: created.attachmentSize,
        author: created.author ? { id: created.author.id, name: created.author.name } : null,
      };
    } catch (error: any) {
      this.logger.error(`Error sending manual message: ${error.message}`);
      return null;
    }
  }

  async getStatistics(): Promise<{
    total: number;
    byChannel: Record<Channel, number>;
    byStatus: Record<ConversationStatus, number>;
    activeToday: number;
  }> {
    try {
      const [total, byChannel, byStatus, activeToday] = await Promise.all([
        this.prisma.conversation.count({ where: { isSandbox: false } }),
        this.prisma.conversation.groupBy({
          by: ['channel'],
          where: { isSandbox: false },
          _count: true,
        }),
        this.prisma.conversation.groupBy({
          by: ['status'],
          where: { isSandbox: false },
          _count: true,
        }),
        this.prisma.conversation.count({
          where: {
            isSandbox: false,
            updatedAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        }),
      ]);

      const channelStats: Record<Channel, number> = {} as any;
      byChannel.forEach((item) => {
        channelStats[item.channel] = item._count;
      });

      const statusStats: Record<ConversationStatus, number> = {} as any;
      byStatus.forEach((item) => {
        statusStats[item.status] = item._count;
      });

      return {
        total,
        byChannel: channelStats,
        byStatus: statusStats,
        activeToday,
      };
    } catch (error: any) {
      this.logger.error(`Error getting statistics: ${error.message}`);
      return {
        total: 0,
        byChannel: {} as any,
        byStatus: {} as any,
        activeToday: 0,
      };
    }
  }

  /**
   * Marcos 2026-07-21: toggle "favorita" símil WhatsApp. Compartido
   * entre operadores (no per-user) — cuando Marcos favoritea, Brenda
   * también la ve destacada. Devuelve el nuevo estado; el caller
   * decide qué hacer con la respuesta (frontend actualiza el ícono).
   */
  async setFavorite(conversationId: string, favorite: boolean): Promise<{ favorite: boolean; favoritedAt: Date | null } | null> {
    try {
      const updated = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          favorite,
          favoritedAt: favorite ? new Date() : null,
        } as any,
        select: {
          favorite: true,
          favoritedAt: true,
        } as any,
      });
      return {
        favorite: (updated as any).favorite,
        favoritedAt: (updated as any).favoritedAt ?? null,
      };
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      this.logger.error(`setFavorite failed for ${conversationId}: ${err?.message ?? err}`);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
