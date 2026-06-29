/**
 * ADAPTERS LAYER - MercadoLibre Service
 *
 * Reads its access_token at call time from OAuthCredentialsService (with
 * automatic refresh-token rotation when within REFRESH_LEEWAY of expiry),
 * falling back to MERCADOLIBRE_ACCESS_TOKEN / _USER_ID in .env when no DB
 * row exists yet. That way the OAuth callback can persist credentials and
 * the next inbound webhook picks them up without a backend restart.
 */

import { Injectable, Logger } from '@nestjs/common';
import { IMercadoLibreService } from '../../use-cases/mercadolibre/mercadolibre.interface';
import {
  MercadoLibreIncomingMessage,
  MercadoLibreOutgoingMessage,
  MercadoLibreSendResult,
  MercadoLibreMessageType,
  MercadoLibreStatus,
} from '../../domain/entities/mercadolibre-message.entity';
import {
  OAuthCredentialsService,
  OAuthExchangeResult,
} from '../oauth/oauth-credentials.service';

interface ResolvedAuth {
  accessToken: string;
  userId: string;
}

/**
 * Compact MercadoLibre listing snapshot used by the AI turn context.
 * Only the fields the agent actually needs to anchor a publication-
 * scoped reply. Raw payload is much larger; we drop the noise.
 */
export interface MercadoLibreListing {
  itemId: string;
  title: string;
  subtitle: string | null;
  price: number | null;
  currencyId: string | null;
  availableQuantity: number | null;
  condition: string | null;
  permalink: string | null;
  descriptionPlain: string | null;
  attributes: Array<{ id: string; name: string; value: string }>;
  status: string | null;
  /** First picture's HTTPS URL — Marcos 2026-06-06: the ML Q&A panel
   *  needs a thumbnail to render the publication card so the operator
   *  can recognise the listing at a glance. Falls back through
   *  `secure_thumbnail` then `thumbnail` for older items. */
  thumbnailUrl: string | null;
}

@Injectable()
export class MercadoLibreService implements IMercadoLibreService {
  private readonly logger = new Logger(MercadoLibreService.name);
  private readonly apiUrl: string;
  private readonly fallbackAccessToken: string | null;
  private readonly fallbackUserId: string | null;

  // Buyer-nickname cache. ML's /questions API only returns `from: {id}`
  // — no nickname. To greet the buyer by their actual apodo (Marcos's
  // 2026-06-01 ask) we follow up with /users/{id}. That's one extra
  // request per unique buyer, so we cache for an hour to keep ML API
  // traffic bounded. Null entries are cached too so repeated misses
  // don't hammer the API. Memory footprint: ~80 chars per entry, so
  // tens of thousands of buyers fit comfortably.
  private readonly nicknameCache = new Map<string, { nickname: string | null; cachedAt: number }>();
  // Marcos 2026-06-29 (perf): cache de la respuesta de
  // fetchOrdersForRange por (provider, fromIso, toIso) con TTL
  // corto. La API de ML /orders/search es genuinamente lenta
  // (~400ms × ~40 páginas = ~17s para cuenta_1). El panel de
  // logística se recarga seguido — sin caché cada load paga ese
  // costo. Con TTL 60s, el primer load del minuto paga, los
  // siguientes son instantáneos. Los cambios manuales del operador
  // (armado, courier, despachado) NO dependen de esta data — vienen
  // del merge con LogisticaArmado local que se hace después.
  private readonly ordersRangeCache = new Map<string, {
    value: {
      orders: any[];
      sellerId: string;
    };
    expiresAt: number;
  }>();
  private readonly NICKNAME_CACHE_TTL_MS = 60 * 60 * 1000;

  constructor(private readonly credentials: OAuthCredentialsService) {
    this.apiUrl = process.env.MERCADOLIBRE_API_URL || 'https://api.mercadolibre.com';
    this.fallbackAccessToken = process.env.MERCADOLIBRE_ACCESS_TOKEN || null;
    this.fallbackUserId = process.env.MERCADOLIBRE_USER_ID || null;
    this.logger.log(
      `MercadoLibre service initialized (env-fallback ${
        this.fallbackAccessToken && this.fallbackUserId ? 'present' : 'absent'
      })`,
    );
  }

  private async resolveAuth(): Promise<ResolvedAuth | null> {
    return this.resolveAuthFor('mercadolibre');
  }

  /**
   * Bloque A item 3 — Marcos 2026-06-08: shared auth resolver. Lets
   * services beyond MercadoLibreService (e.g. MlCompetitorsService)
   * pick which cuenta to authenticate with — refresh happens here so
   * callers never see an expired token. Public so the DI consumer
   * can call it via the @Global token alias.
   */
  async resolveAuthFor(
    provider: 'mercadolibre' | 'mercadolibre_cuenta2',
  ): Promise<ResolvedAuth | null> {
    const stored = await this.credentials.getFresh(provider, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (stored?.accessToken && stored.externalId) {
      return { accessToken: stored.accessToken, userId: stored.externalId };
    }
    if (provider === 'mercadolibre' && this.fallbackAccessToken && this.fallbackUserId) {
      return {
        accessToken: this.fallbackAccessToken,
        userId: this.fallbackUserId,
      };
    }
    return null;
  }

  private async refreshAccessToken(
    refreshToken: string,
  ): Promise<OAuthExchangeResult> {
    const appId = process.env.MERCADOLIBRE_APP_ID;
    const clientSecret = process.env.MERCADOLIBRE_CLIENT_SECRET;
    const tokenUrl =
      process.env.MERCADOLIBRE_TOKEN_URL ||
      'https://api.mercadolibre.com/oauth/token';
    if (!appId || !clientSecret) {
      throw new Error('MERCADOLIBRE_APP_ID / MERCADOLIBRE_CLIENT_SECRET missing');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: appId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok) {
      throw new Error(
        `refresh failed (HTTP ${res.status}): ${JSON.stringify(json)}`,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      externalId: json.user_id != null ? String(json.user_id) : null,
      expiresInSec: Number(json.expires_in) || 6 * 60 * 60,
      metadata: { tokenType: json.token_type, scope: json.scope },
    };
  }

  async answerQuestion(
    questionId: string,
    text: string,
    // Marcos 2026-06-12: the release flow was always authenticating
    // with cuenta 1's token regardless of which cuenta the question
    // came from. ML's `/answers` accepts the wrong-cuenta token with
    // a 200 OK but the answer never lands on the buyer's question —
    // it goes to limbo. So drafts on cuenta 2 looked sent (no error)
    // but stayed UNANSWERED on ML's side. Now callers can pass the
    // owning cuenta and we authenticate with the right token. The
    // arg is optional so legacy single-cuenta call sites keep
    // working.
    accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2' | null,
  ): Promise<MercadoLibreSendResult> {
    const which: 'mercadolibre' | 'mercadolibre_cuenta2' =
      accountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
    const auth = await this.resolveAuthFor(which);
    if (!auth) {
      return MercadoLibreSendResult.failure(`MercadoLibre (${which}) not configured`);
    }

    try {
      const url = `${this.apiUrl}/answers`;
      this.logger.debug(`Answering question ${questionId} via ${which}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question_id: questionId, text }),
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.error(`Failed to answer question ${questionId} (${which}): ${JSON.stringify(data)}`);
        return MercadoLibreSendResult.failure(data.message || 'Failed to answer');
      }
      this.logger.log(`✅ Question answered (${which}): ${questionId} -> ${data.id}`);
      return MercadoLibreSendResult.success(data.id);
    } catch (error: any) {
      this.logger.error(`Error answering question ${questionId} (${which}): ${error.message}`);
      return MercadoLibreSendResult.failure(error.message);
    }
  }

  async sendMessage(
    message: MercadoLibreOutgoingMessage,
  ): Promise<MercadoLibreSendResult> {
    const auth = await this.resolveAuth();
    if (!auth) {
      return MercadoLibreSendResult.failure('MercadoLibre not configured');
    }
    if (!message.validate()) {
      return MercadoLibreSendResult.failure(
        'Invalid message: must be 1-2000 characters',
      );
    }
    try {
      if (message.type === MercadoLibreMessageType.QUESTION && message.questionId) {
        return await this.answerQuestion(message.questionId, message.text);
      }
      return MercadoLibreSendResult.failure('Direct messaging not yet implemented');
    } catch (error: any) {
      this.logger.error(`Error sending message: ${error.message}`);
      return MercadoLibreSendResult.failure(error.message);
    }
  }

  /**
   * Bloque A item 1 — Marcos 2026-06-06: post-venta ML. Pull the
   * latest unread buyer message in the post-purchase chat for a
   * given pack id. Returns null when there's nothing unread (e.g.
   * the seller already replied) or when the chat thread isn't
   * accessible.
   *
   * Endpoint shape: GET /messages/packs/{packId}/sellers/{sellerId}
   * Response: { messages: [ { id, from: {user_id}, message_resources, message, status, message_date: { created } } ] }
   */
  async fetchPostVentaMessage(
    packId: string,
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' = 'mercadolibre',
  ): Promise<MercadoLibreIncomingMessage | null> {
    const cred = await this.credentials.getFresh(accountKey, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (!cred?.accessToken || !cred.externalId) return null;
    // Marcos 2026-06-10: ML's post-sale endpoint requires the
    // `?tag=post_sale` query; without it the same path returns
    // 404 ("resource not found"). The legacy untagged path was
    // returning false-empty results, masking real buyer messages.
    const url = `${this.apiUrl}/messages/packs/${packId}/sellers/${cred.externalId}?tag=post_sale`;
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cred.accessToken}` },
      });
      if (!r.ok) {
        this.logger.warn(`Post-venta fetch HTTP ${r.status} for pack ${packId}`);
        return null;
      }
      const body: any = await r.json().catch(() => ({}));
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      if (msgs.length === 0) return null;
      // Find newest message from the BUYER (not from us). Sellers can
      // see their own messages in the same thread; we only want to
      // react to incoming buyer messages. Compare from.user_id !=
      // our seller id.
      const ourId = String(cred.externalId);
      const buyerMsgs = msgs.filter((m: any) => String(m?.from?.user_id ?? '') !== ourId);
      if (buyerMsgs.length === 0) return null;
      buyerMsgs.sort((a: any, b: any) => {
        const da = a?.message_date?.created ?? a?.date_created ?? '';
        const db = b?.message_date?.created ?? b?.date_created ?? '';
        return String(db).localeCompare(String(da));
      });
      const latest = buyerMsgs[0];
      const text = String(latest?.text ?? latest?.message ?? '').trim();
      if (!text) return null;
      const buyerId = String(latest?.from?.user_id ?? 'unknown');
      const dateStr = latest?.message_date?.created ?? latest?.date_created ?? null;
      return new MercadoLibreIncomingMessage(
        // ID = packId so the outbound replier knows where to send.
        // ML's post-venta send endpoint is keyed by pack, not msg id.
        packId,
        MercadoLibreMessageType.MESSAGE,
        buyerId,
        buyerId,
        text,
        null,
        MercadoLibreStatus.UNANSWERED,
        dateStr ? new Date(dateStr) : new Date(),
        accountKey,
      );
    } catch (err: any) {
      this.logger.error(`Post-venta fetch errored for pack ${packId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Marcos 2026-06-10: lightweight unread check for the logística
   * panel. Returns true iff the LATEST message in the post-sale
   * thread is from the BUYER (i.e. the seller hasn't followed up).
   * That's the signal the picker actually cares about: "does this
   * box have a customer waiting on a reply before I seal it?"
   * Returns false when the latest message is from the seller (we
   * already answered) or when the thread is empty / unreachable.
   */
  async hasUnreadPostVenta(
    packId: string,
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' = 'mercadolibre',
  ): Promise<boolean> {
    const cred = await this.credentials.getFresh(accountKey, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (!cred?.accessToken || !cred.externalId) return false;
    const url = `${this.apiUrl}/messages/packs/${packId}/sellers/${cred.externalId}?tag=post_sale`;
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cred.accessToken}` },
      });
      if (!r.ok) return false;
      const body: any = await r.json().catch(() => ({}));
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      if (msgs.length === 0) return false;
      // ML returns newest-first by default but we sort defensively
      // — the picker can't afford a stale ordering bug here.
      const sorted = [...msgs].sort((a: any, b: any) => {
        const da = a?.message_date?.created ?? a?.date_created ?? '';
        const db = b?.message_date?.created ?? b?.date_created ?? '';
        return String(db).localeCompare(String(da));
      });
      const latest = sorted[0];
      const fromId = String(latest?.from?.user_id ?? '');
      const ourId = String(cred.externalId);
      return fromId !== '' && fromId !== ourId;
    } catch {
      return false;
    }
  }

  /**
   * Bloque A item 2 — Marcos 2026-06-06: reclamos ML. Pull the
   * claim header + reason text via ML's post-purchase claims API.
   * Returns a MercadoLibreIncomingMessage of type CLAIM carrying
   * the human-readable reason in `text` so the operator panel
   * shows what the buyer actually complained about instead of just
   * a placeholder id.
   *
   * Endpoint: GET /post-purchase/v1/claims/{claim_id}
   * Response surface (relevant fields):
   *   id, type, status, stage, reason_id, resolution, players[]
   *   (each with role + user_id)
   *
   * Marcos 2026-06-22: el panel de Reclamos mostraba sólo el
   * summary metadata (`[Reclamo ML id] Tipo: mediations · Estado:
   * opened · Etapa: claim · Motivo (id): PDD9943`) y Marcos no podía
   * leer qué dice el comprador realmente. Ahora hacemos un segundo
   * fetch a `/post-purchase/v1/claims/{id}/messages` para traer el
   * mensaje más reciente del comprador y lo ponemos arriba; el
   * summary queda como pie chiquito para el contexto. Si la API
   * rechaza el sub-fetch (403 / paywall) caemos al summary solo.
   */
  private reasonDetailCache = new Map<string, { detail: string | null; at: number }>();

  /**
   * Marcos 2026-06-22: ML expone el texto legible del motivo en
   * `/post-purchase/v1/claims/reasons/{reason_id}` (campo `detail`,
   * ej "Llegó lo que compré en buenas condiciones pero no lo quiero"
   * para PDD9939). El catálogo cambia poco — cacheo en memoria por
   * 24h para no refetchear el mismo reason por cada reclamo.
   */
  private async fetchClaimReasonDetail(
    reasonId: string,
    accessToken: string,
  ): Promise<string | null> {
    const cached = this.reasonDetailCache.get(reasonId);
    if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) {
      return cached.detail;
    }
    try {
      const r = await fetch(`${this.apiUrl}/post-purchase/v1/claims/reasons/${reasonId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        this.reasonDetailCache.set(reasonId, { detail: null, at: Date.now() });
        return null;
      }
      const j: any = await r.json().catch(() => ({}));
      const detail = typeof j?.detail === 'string' && j.detail.trim().length > 0 ? j.detail.trim() : null;
      this.reasonDetailCache.set(reasonId, { detail, at: Date.now() });
      return detail;
    } catch {
      return null;
    }
  }

  /**
   * Marcos 2026-06-22: lista canónica de reclamos abiertos en ML
   * para una cuenta. Sirve para reconciliar nuestra DB contra la
   * verdad de ML — el flujo de webhooks tiene gaps (webhook perdido,
   * reclamo cerrado en ML sin que nos avisen), así que cada N minutos
   * pedimos el set completo y ajustamos. Endpoint:
   *   GET /post-purchase/v1/claims/search?status=opened&limit=50
   * Devuelve un array; pagina hasta agotar.
   */
  async fetchOpenClaimIds(
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' = 'mercadolibre',
  ): Promise<string[]> {
    const cred = await this.credentials.getFresh(accountKey, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (!cred?.accessToken) return [];
    const out: string[] = [];
    let offset = 0;
    const perPage = 50;
    const maxPages = 20; // safety cap — 1000 abiertos es muchísimo
    for (let page = 0; page < maxPages; page++) {
      try {
        const url = `${this.apiUrl}/post-purchase/v1/claims/search?status=opened&limit=${perPage}&offset=${offset}`;
        const r = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${cred.accessToken}` },
        });
        if (!r.ok) {
          this.logger.warn(`Open-claims search HTTP ${r.status} on ${accountKey} (offset=${offset})`);
          break;
        }
        const j: any = await r.json().catch(() => ({}));
        // El payload viene como array al root O bajo `data` / `results`.
        const arr: any[] = Array.isArray(j)
          ? j
          : Array.isArray(j?.data) ? j.data
          : Array.isArray(j?.results) ? j.results
          : [];
        if (arr.length === 0) break;
        for (const c of arr) {
          if (c?.id != null) out.push(String(c.id));
        }
        if (arr.length < perPage) break;
        offset += arr.length;
      } catch (err: any) {
        this.logger.warn(`Open-claims search threw on ${accountKey}: ${err?.message ?? err}`);
        break;
      }
    }
    return out;
  }

  async fetchClaimDetails(
    claimId: string,
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' = 'mercadolibre',
  ): Promise<MercadoLibreIncomingMessage | null> {
    const cred = await this.credentials.getFresh(accountKey, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (!cred?.accessToken) return null;
    try {
      const r = await fetch(`${this.apiUrl}/post-purchase/v1/claims/${claimId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cred.accessToken}` },
      });
      if (!r.ok) {
        this.logger.warn(`Claim fetch HTTP ${r.status} for ${claimId}`);
        return null;
      }
      const c: any = await r.json().catch(() => ({}));
      // The buyer is the "complainant" player; if missing, fall back
      // to the first non-seller player.
      const sellerId = String(cred.externalId ?? '');
      const players = Array.isArray(c?.players) ? c.players : [];
      const buyer =
        players.find((p: any) => p?.role === 'complainant') ??
        players.find((p: any) => String(p?.user_id) !== sellerId) ??
        null;
      const buyerId = buyer?.user_id != null ? String(buyer.user_id) : 'unknown';
      // Marcos 2026-06-22: pendingFor — quién tiene el próximo turno.
      // Reglas (más prioritario primero):
      //   seller (Servifibras) tiene available_actions → 'seller'
      //   buyer (comprador) tiene available_actions    → 'buyer'
      //   sino                                          → 'ml'
      // El panel agrupa por este flag y prioriza 'seller'.
      const sellerPlayer = players.find(
        (p: any) => p?.type === 'seller' || p?.role === 'respondent',
      );
      const buyerPlayer = players.find(
        (p: any) => p?.type === 'buyer' || p?.role === 'complainant',
      );
      const sellerHasActions =
        Array.isArray(sellerPlayer?.available_actions) && sellerPlayer.available_actions.length > 0;
      const buyerHasActions =
        Array.isArray(buyerPlayer?.available_actions) && buyerPlayer.available_actions.length > 0;
      const pendingFor: 'seller' | 'buyer' | 'ml' =
        sellerHasActions ? 'seller' : buyerHasActions ? 'buyer' : 'ml';
      const summaryParts: string[] = [];
      if (c?.type) summaryParts.push(`Tipo: ${c.type}`);
      if (c?.status) summaryParts.push(`Estado: ${c.status}`);
      if (c?.stage) summaryParts.push(`Etapa: ${c.stage}`);
      // Razón legible — fetch al catálogo de reasons de ML
      // (/claims/reasons/{id}) que devuelve `detail` en español ej.
      // 'Llegó lo que compré en buenas condiciones pero no lo
      // quiero' para PDD9939. Cacheado 24h en memoria así N reclamos
      // con el mismo reason no fan-out a N requests.
      let reasonLabel: string | null = null;
      if (typeof c?.reason_id === 'string' && c.reason_id) {
        reasonLabel = await this.fetchClaimReasonDetail(c.reason_id, cred.accessToken);
      }
      // Si reasonLabel viene de la API la mostramos limpia + el id
      // entre paréntesis para el operador que quiera buscar en la
      // doc; si no, fallback al payload o al id solo.
      if (reasonLabel && c?.reason_id) summaryParts.push(`Motivo: ${reasonLabel} (${c.reason_id})`);
      else if (reasonLabel) summaryParts.push(`Motivo: ${reasonLabel}`);
      else if (c?.reason_id) summaryParts.push(`Motivo (id): ${c.reason_id}`);
      if (c?.resolution?.reason) summaryParts.push(`Resolución: ${c.resolution.reason}`);
      if (c?.resolution?.benefited?.length) summaryParts.push(`Beneficiado: ${c.resolution.benefited.join(', ')}`);

      // Marcos 2026-06-22: segundo fetch al thread de mensajes del
      // reclamo. Devuelve los últimos N mensajes con sender + text.
      // Filtramos los que mandó el comprador (sender_role !== seller)
      // y tomamos el más reciente para mostrar al operador.
      let buyerText: string | null = null;
      try {
        const mr = await fetch(`${this.apiUrl}/post-purchase/v1/claims/${claimId}/messages`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${cred.accessToken}` },
        });
        if (mr.ok) {
          const mj: any = await mr.json().catch(() => ({}));
          const arr = Array.isArray(mj?.messages) ? mj.messages : (Array.isArray(mj) ? mj : []);
          // ML usa `sender_role` ('respondent' = seller, 'complainant' = buyer)
          // OR `from.user_id` que comparamos contra sellerId. Tomamos
          // el más reciente del comprador con texto no-vacío.
          // Marcos 2026-06-24 (caso 5529086122 — "no trae todos"):
          // antes tomábamos sólo el último mensaje del comprador.
          // Ahora concatenamos TODOS los mensajes del thread (buyer +
          // mediador ML) en orden cronológico ascendente, así el
          // operador ve la historia completa de la disputa en la
          // misma bubble. Cada uno prefijado con quién lo mandó +
          // fecha corta.
          // Marcos 2026-06-29 (reclamo 51410476 — mediador 29/6
          // mostraba <p dir="ltr"><span style="white-space:pre-wrap">…
          // como texto crudo): ML manda los mensajes del mediador en
          // HTML formateado. Strip tags + decodificación de entidades
          // comunes para que el panel reciba texto plano. Aplicamos a
          // todos los mensajes (comprador a veces también pega con
          // formato) — el reclamo es contenido text-only, no hay
          // razón para preservar HTML.
          const stripHtmlAndDecode = (raw: string): string => {
            if (!raw) return '';
            const entities: Record<string, string> = {
              '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
              '&quot;': '"', '&#39;': "'", '&apos;': "'",
              // Marcos 2026-06-29: ML mediador encodea acentos como
              // entidades (á → &aacute;, etc). Sin esto el texto
              // limpio se ve "podrás" → "podr&aacute;s". Cubro las
              // 12 más comunes de español + ñ/¿/¡.
              '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
              '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
              '&ntilde;': 'ñ', '&Ntilde;': 'Ñ',
              '&iexcl;': '¡', '&iquest;': '¿',
              '&uuml;': 'ü', '&Uuml;': 'Ü',
            };
            let cleaned = raw
              .replace(/<\s*br\s*\/?>/gi, '\n')
              .replace(/<\/?\s*p\b[^>]*>/gi, '\n')
              .replace(/<[^>]+>/g, '');
            for (const [ent, ch] of Object.entries(entities)) {
              cleaned = cleaned.split(ent).join(ch);
            }
            // Numeric entities (decimal + hex). Más raros pero ML
            // a veces los manda.
            cleaned = cleaned
              .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
              .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
            return cleaned
              .replace(/\n{3,}/g, '\n\n')
              .replace(/[ \t]+\n/g, '\n')
              .trim();
          };
          const threadMsgs = arr
            .map((m: any) => {
              const role = String(m?.sender_role ?? '').toLowerCase();
              const fromId = String(m?.from?.user_id ?? m?.sender_id ?? '');
              let sender: 'comprador' | 'mediador' | 'vendedor';
              if (role === 'complainant' || role === 'buyer') sender = 'comprador';
              else if (role === 'respondent' || role === 'seller') sender = 'vendedor';
              else if (role === 'mediator' || role === 'internal') sender = 'mediador';
              else if (fromId && fromId !== sellerId) sender = 'comprador';
              else sender = 'vendedor';
              return {
                sender,
                text: stripHtmlAndDecode(String(m?.message ?? m?.text ?? '')),
                dateRaw: m?.date_created ?? m?.created_at ?? m?.last_updated ?? null,
              };
            })
            .filter((m: { text: string }) => m.text.length > 0)
            .sort((a: any, b: any) => {
              const da = a.dateRaw ? new Date(a.dateRaw).getTime() : 0;
              const db = b.dateRaw ? new Date(b.dateRaw).getTime() : 0;
              return da - db; // ascendente: más viejo primero
            });
          if (threadMsgs.length > 0) {
            const fmtDate = (d: string | null) => {
              if (!d) return '';
              try {
                const dt = new Date(d);
                return ` (${dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })})`;
              } catch { return ''; }
            };
            buyerText = threadMsgs
              .map((m: any) => `${m.sender}${fmtDate(m.dateRaw)}: ${m.text}`)
              .join('\n\n');
          }
        } else if (mr.status !== 404 && mr.status !== 403) {
          this.logger.warn(`Claim messages fetch HTTP ${mr.status} for ${claimId}`);
        }
      } catch (err: any) {
        this.logger.warn(`Claim messages fetch threw for ${claimId}: ${err?.message ?? err}`);
      }

      const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : null;
      // Format final: texto del comprador arriba, summary como
      // contexto debajo. Si no hay texto, dejamos sólo el summary
      // (mejor que un placeholder vacío).
      let text: string;
      if (buyerText && summary) {
        text = `${buyerText}\n\n— Reclamo ML ${claimId} · ${summary}`;
      } else if (buyerText) {
        text = `${buyerText}\n\n— Reclamo ML ${claimId}`;
      } else if (summary) {
        text = `[Reclamo ML ${claimId}] ${summary}`;
      } else {
        text = `[Reclamo ML ${claimId}]`;
      }
      return new MercadoLibreIncomingMessage(
        claimId,
        MercadoLibreMessageType.CLAIM,
        buyerId,
        buyerId,
        text,
        null,
        MercadoLibreStatus.UNANSWERED,
        c?.date_created ? new Date(c.date_created) : new Date(),
        accountKey,
        pendingFor,
      );
    } catch (err: any) {
      this.logger.error(`Claim fetch errored for ${claimId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Bloque A item 1 — send a post-purchase message to the buyer for a
   * given pack id. ML's endpoint:
   *   POST /messages/packs/{packId}/sellers/{sellerId}
   *     body: { from: {user_id: <seller>}, to: {user_id: <buyer>}, text: "..." }
   * Returns MercadoLibreSendResult so it slots into the existing
   * outbound replier path.
   */
  async sendPostVentaMessage(args: {
    packId: string;
    buyerId: string;
    text: string;
    accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2';
  }): Promise<MercadoLibreSendResult> {
    const accountKey = args.accountKey ?? 'mercadolibre';
    const cred = await this.credentials.getFresh(accountKey, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (!cred?.accessToken || !cred.externalId) {
      return MercadoLibreSendResult.failure(
        `MercadoLibre ${accountKey} not configured for post-venta send`,
      );
    }
    if (!args.text || args.text.length === 0 || args.text.length > 2000) {
      return MercadoLibreSendResult.failure('Invalid message: must be 1-2000 characters');
    }
    const url = `${this.apiUrl}/messages/packs/${args.packId}/sellers/${cred.externalId}`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cred.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { user_id: cred.externalId },
          to: { user_id: args.buyerId },
          text: args.text,
        }),
      });
      const data: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        this.logger.error(
          `Post-venta send HTTP ${r.status} for pack ${args.packId}: ${JSON.stringify(data).slice(0, 200)}`,
        );
        return MercadoLibreSendResult.failure(data?.message || `HTTP ${r.status}`);
      }
      const messageId = String(data?.id ?? data?.message_id ?? args.packId);
      this.logger.log(`✉️ Post-venta message sent pack=${args.packId} id=${messageId}`);
      return MercadoLibreSendResult.success(messageId);
    } catch (err: any) {
      this.logger.error(`Post-venta send errored for pack ${args.packId}: ${err.message}`);
      return MercadoLibreSendResult.failure(err.message);
    }
  }

  /**
   * Bloque B item 1 — Marcos 2026-06-06: cuenta resolver. Given the
   * ML seller user_id that arrived on the webhook, find which
   * OAuthCredential it belongs to so the conversation can be tagged
   * with the correct cuenta key. Checks the two canonical provider
   * keys first (cheap, hits the row by primary key), falls back to
   * a scan of the credentials table for any other ML cuenta we
   * might wire in later. Returns null when the user_id doesn't map
   * to any connected cuenta (drops back to legacy untagged
   * behaviour for the conversation).
   */
  async resolveAccountKey(userId: string | number | null | undefined): Promise<string | null> {
    if (userId == null) return null;
    const idStr = String(userId).trim();
    if (!idStr || idStr === 'unknown') return null;
    for (const provider of ['mercadolibre', 'mercadolibre_cuenta2']) {
      try {
        const cred = await this.credentials.getRaw(provider);
        if (cred?.externalId && String(cred.externalId) === idStr) {
          return provider;
        }
      } catch {
        /* ignore — try the next provider */
      }
    }
    return null;
  }

  parseIncomingMessage(webhookPayload: any): MercadoLibreIncomingMessage | null {
    try {
      const topic = webhookPayload.topic;
      const resource = webhookPayload.resource;
      if (!topic || !resource) {
        this.logger.debug('Invalid webhook payload: missing topic or resource');
        return null;
      }
      const resourceId = resource.split('/').pop();

      if (topic === 'questions') {
        this.logger.log(`📩 MercadoLibre question notification: ${resourceId}`);
        return new MercadoLibreIncomingMessage(
          resourceId,
          MercadoLibreMessageType.QUESTION,
          'unknown',
          webhookPayload.user_id || 'unknown',
          '',
          null,
          MercadoLibreStatus.UNANSWERED,
          new Date(),
        );
      }

      if (topic === 'feedback' || topic === 'orders_feedback') {
        this.logger.log(`📩 MercadoLibre feedback notification: ${resourceId}`);
        return new MercadoLibreIncomingMessage(
          resourceId,
          MercadoLibreMessageType.REVIEW,
          'unknown',
          webhookPayload.user_id || 'unknown',
          '',
          null,
          MercadoLibreStatus.UNANSWERED,
          new Date(),
        );
      }

      if (topic === 'claims') {
        this.logger.log(`📩 MercadoLibre claim notification: ${resourceId}`);
        return new MercadoLibreIncomingMessage(
          resourceId,
          MercadoLibreMessageType.CLAIM,
          'unknown',
          webhookPayload.user_id || 'unknown',
          '',
          null,
          MercadoLibreStatus.UNANSWERED,
          new Date(),
        );
      }

      // Bloque A item 1 — Marcos 2026-06-06: post-venta ML. After a
      // buyer purchases, ML lets seller and buyer exchange direct
      // messages via the post-purchase chat. ML notifies us with
      // topic="messages" and resource format
      //   /messages/packs/{pack_id}/sellers/{seller_id}
      // We extract the packId from the resource path because that's
      // the key the messages endpoint uses on both fetch + reply.
      if (topic === 'messages') {
        const packMatch = /\/messages\/packs\/([^/]+)/.exec(resource);
        const packId = packMatch?.[1] ?? resourceId;
        this.logger.log(`📩 MercadoLibre post-venta message notification: pack ${packId}`);
        return new MercadoLibreIncomingMessage(
          packId,
          MercadoLibreMessageType.MESSAGE,
          'unknown',
          webhookPayload.user_id || 'unknown',
          '',
          null,
          MercadoLibreStatus.UNANSWERED,
          new Date(),
        );
      }

      // Marcos 2026-06-17: ML migrated the post-venta event stream
      // from the legacy topic-per-event names (`messages`, `claims`)
      // to a unified `post_purchase` topic that uses the `resource`
      // path + `actions` array to disambiguate. Detect both shapes
      // so the agent still picks up claims + post-venta DMs on the
      // new event names.
      if (topic === 'post_purchase') {
        const actions: string[] = Array.isArray(webhookPayload.actions)
          ? webhookPayload.actions.map(String)
          : [];
        // Claim — resource looks like /post-purchase/v1/claims/{id}
        const claimMatch = /\/claims\/([^/]+)/.exec(resource);
        if (claimMatch || actions.includes('claims')) {
          const claimId = claimMatch?.[1] ?? resourceId;
          this.logger.log(`📩 MercadoLibre claim notification (post_purchase): ${claimId}`);
          return new MercadoLibreIncomingMessage(
            claimId,
            MercadoLibreMessageType.CLAIM,
            'unknown',
            webhookPayload.user_id || 'unknown',
            '',
            null,
            MercadoLibreStatus.UNANSWERED,
            new Date(),
          );
        }
        // Post-venta DM — resource looks like /messages/packs/{packId}/...
        const packMatch = /\/messages\/packs\/([^/]+)/.exec(resource);
        if (packMatch || actions.includes('messages')) {
          const packId = packMatch?.[1] ?? resourceId;
          this.logger.log(`📩 MercadoLibre post-venta message notification (post_purchase): pack ${packId}`);
          return new MercadoLibreIncomingMessage(
            packId,
            MercadoLibreMessageType.MESSAGE,
            'unknown',
            webhookPayload.user_id || 'unknown',
            '',
            null,
            MercadoLibreStatus.UNANSWERED,
            new Date(),
          );
        }
        this.logger.debug(`post_purchase webhook with unrecognised resource/actions: ${resource} ${JSON.stringify(actions)}`);
        return null;
      }

      // Marcos 2026-06-17: ML pings us for every new order (orders_v2
      // topic). We already pull orders via a 5-min cron, so the
      // webhook ping is redundant — drop it silently instead of
      // logging "not supported" on every order.
      if (topic === 'orders_v2' || topic === 'orders') {
        this.logger.debug(`Order notification ignored (cron handles it): ${resourceId}`);
        return null;
      }

      this.logger.debug(`Webhook topic not supported: ${topic}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error parsing webhook: ${error.message}`);
      return null;
    }
  }

  /**
   * Marcos 2026-06-12: variant accepting an explicit account key so
   * the backfill admin endpoint can sweep BOTH cuentas (the default
   * `getUnansweredQuestions()` only resolves cuenta 1). Returns
   * `[]` when the cuenta isn't connected.
   */
  async getUnansweredQuestionsFor(
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2',
  ): Promise<MercadoLibreIncomingMessage[]> {
    const auth = await this.resolveAuthFor(accountKey);
    if (!auth) return [];
    return this.fetchUnanswered(auth);
  }

  async getUnansweredQuestions(): Promise<MercadoLibreIncomingMessage[]> {
    const auth = await this.resolveAuth();
    if (!auth) return [];
    return this.fetchUnanswered(auth);
  }

  private async fetchUnanswered(auth: ResolvedAuth): Promise<MercadoLibreIncomingMessage[]> {
    try {
      const url = `${this.apiUrl}/questions/search?seller_id=${auth.userId}&status=UNANSWERED&sort_fields=date_created&sort_types=DESC`;
      this.logger.debug('Fetching unanswered questions');
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!response.ok) {
        const error = await response.json();
        this.logger.error(`Failed to fetch questions: ${JSON.stringify(error)}`);
        return [];
      }
      const data = await response.json();
      const questions: MercadoLibreIncomingMessage[] = [];
      for (const q of data.questions || []) {
        const buyerId = q.from.id.toString();
        const nickname = await this.resolveBuyerNickname(buyerId, auth.accessToken);
        questions.push(
          new MercadoLibreIncomingMessage(
            q.id.toString(),
            MercadoLibreMessageType.QUESTION,
            nickname || buyerId,
            buyerId,
            q.text,
            q.item_id,
            this.mapStatus(q.status),
            new Date(q.date_created),
          ),
        );
      }
      this.logger.log(`Found ${questions.length} unanswered questions`);
      return questions;
    } catch (error: any) {
      this.logger.error(`Error fetching unanswered questions: ${error.message}`);
      return [];
    }
  }

  /**
   * Marcos 2026-06-24: pagina /questions/search?item=X&status=ANSWERED
   * para traer TODO el histórico de Q&A de una publicación. La idea es
   * alimentar la tabla MlPublicationKnowledge — base de verdad por
   * publicación que el modo de respuesta cerrado va a usar.
   *
   * ML paginate via offset+limit; limit max es 50. Cortamos en 2000
   * preguntas como tope defensivo (un item con más historia que eso
   * es un caso raro y conviene mirarlo a mano).
   */
  async fetchAnsweredQuestionsForItem(
    itemId: string,
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' = 'mercadolibre',
  ): Promise<Array<{
    id: string;
    text: string;
    answerText: string | null;
    dateCreated: Date;
    answeredAt: Date | null;
    fromUserId: string;
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
  }>> {
    const cred = await this.credentials.getFresh(accountKey, (refreshToken) =>
      this.refreshAccessToken(refreshToken),
    );
    if (!cred?.accessToken) return [];
    const resolved = accountKey;
    const out: Array<{
      id: string;
      text: string;
      answerText: string | null;
      dateCreated: Date;
      answeredAt: Date | null;
      fromUserId: string;
      accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
    }> = [];
    let offset = 0;
    const limit = 50;
    const MAX_PAGES = 40; // 40 × 50 = 2000 questions cap
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${this.apiUrl}/questions/search?item=${encodeURIComponent(itemId)}&status=ANSWERED&limit=${limit}&offset=${offset}&sort_fields=date_created&sort_types=ASC`;
      const r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cred.accessToken}` },
      });
      if (!r.ok) {
        this.logger.warn(`fetchAnsweredQuestionsForItem ${itemId} HTTP ${r.status}; stopping`);
        break;
      }
      const j: any = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.questions) ? j.questions : [];
      if (arr.length === 0) break;
      for (const q of arr) {
        const id = String(q?.id ?? '');
        const text = String(q?.text ?? '').trim();
        const fromId = String(q?.from?.id ?? '');
        const created = q?.date_created ? new Date(q.date_created) : null;
        if (!id || !text || !created) continue;
        const answer = q?.answer ?? null;
        const answerText = typeof answer?.text === 'string' ? answer.text.trim() : null;
        const answeredAt = answer?.date_created ? new Date(answer.date_created) : null;
        out.push({
          id,
          text,
          answerText,
          dateCreated: created,
          answeredAt,
          fromUserId: fromId,
          accountKey: resolved,
        });
      }
      if (arr.length < limit) break;
      offset += limit;
    }
    this.logger.log(`fetchAnsweredQuestionsForItem ${itemId}: ${out.length} preguntas`);
    return out;
  }

  async healthCheck(): Promise<boolean> {
    const auth = await this.resolveAuth();
    if (!auth) return false;
    try {
      const url = `${this.apiUrl}/users/${auth.userId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      return response.ok;
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  async fetchQuestionDetails(
    questionId: string,
    mlAccountKey: string | null = null,
  ): Promise<MercadoLibreIncomingMessage | null> {
    // Marcos 2026-06-11: pick the token for the cuenta that owns the
    // listing. Before this, the call hardcoded cuenta 1's auth and
    // any cuenta-2 question came back without the `from` field —
    // `q.from.id` then threw "Cannot read properties of undefined
    // (reading 'id')" and the question never reached the CRM. The
    // mlAccountKey is already plumbed in by the controller from
    // webhook.user_id; we just have to use it.
    const provider: 'mercadolibre' | 'mercadolibre_cuenta2' =
      mlAccountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
    const auth = await this.resolveAuthFor(provider);
    if (!auth) {
      this.logger.warn(`No auth for ${provider} — cannot fetch question ${questionId}`);
      return null;
    }
    try {
      const url = `${this.apiUrl}/questions/${questionId}`;
      this.logger.debug(`Fetching question details: ${questionId} (via ${provider})`);
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!response.ok) {
        this.logger.error(`Failed to fetch question ${questionId}: HTTP ${response.status}`);
        return null;
      }
      const q = await response.json();
      // Defence-in-depth: if ML's payload shape ever changes again,
      // log and skip instead of throwing.
      if (!q || typeof q !== 'object' || !q.from || q.from.id == null) {
        this.logger.warn(
          `Question ${questionId} payload missing q.from.id — ML response: ${JSON.stringify(q).slice(0, 300)}`,
        );
        return null;
      }
      // ML's /questions endpoint returns `from: { id }` only — no
      // nickname (verified 2026-06-02 against live traffic). Without a
      // follow-up call to /users/{id} the greeting falls back to the
      // numeric user_id, which is what Marcos surfaced on 2026-06-02:
      // "está tomando un número y no el nombre de usuario". Resolve
      // the buyer's actual apodo via the cached resolver below.
      const buyerId = q.from.id.toString();
      const nickname = await this.resolveBuyerNickname(buyerId, auth.accessToken);
      this.logger.log(`📩 Question from ${nickname ?? buyerId}: "${q.text.substring(0, 50)}..."`);
      // Bloque B item 1 — derive mlAccountKey if the caller didn't
      // supply one. q.seller_id is Servifibras's user id for the
      // cuenta that owns this listing; matching it against the OAuth
      // credentials externalId tells us which cuenta key to stamp.
      const resolvedAccountKey =
        mlAccountKey ?? (q?.seller_id != null
          ? await this.resolveAccountKey(q.seller_id)
          : null);
      return new MercadoLibreIncomingMessage(
        q.id.toString(),
        MercadoLibreMessageType.QUESTION,
        nickname || buyerId,
        buyerId,
        q.text,
        q.item_id,
        this.mapStatus(q.status),
        new Date(q.date_created),
        resolvedAccountKey,
      );
    } catch (error: any) {
      this.logger.error(`Error fetching question details: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve a ML buyer's nickname from their user_id by calling
   * /users/{id}. Cached for an hour to bound API traffic. On any
   * error returns null so the caller can fall back to the user_id —
   * silently degrading is better than blocking the reply pipeline.
   */
  private async resolveBuyerNickname(
    userId: string,
    accessToken: string,
  ): Promise<string | null> {
    const cached = this.nicknameCache.get(userId);
    if (cached && Date.now() - cached.cachedAt < this.NICKNAME_CACHE_TTL_MS) {
      return cached.nickname;
    }
    try {
      const r = await fetch(`${this.apiUrl}/users/${userId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        this.nicknameCache.set(userId, { nickname: null, cachedAt: Date.now() });
        return null;
      }
      const j: any = await r.json();
      const nickname =
        typeof j.nickname === 'string' && j.nickname.trim().length > 0
          ? j.nickname.trim()
          : null;
      this.nicknameCache.set(userId, { nickname, cachedAt: Date.now() });
      return nickname;
    } catch (err: any) {
      this.logger.debug(`Nickname lookup failed for ${userId}: ${err.message}`);
      this.nicknameCache.set(userId, { nickname: null, cachedAt: Date.now() });
      return null;
    }
  }

  /**
   * Compact representation of an ML listing for the AI turn context.
   * Built from `GET /items/{itemId}` (catalog row, attributes, price,
   * stock, permalink) + `GET /items/{itemId}/description` (long-form
   * description, separate endpoint in ML's API). The AI doesn't need
   * the full raw payload — only the operator-facing fields that anchor
   * a reply to the publication the buyer is actually looking at.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listingCache = new Map<string, { value: MercadoLibreListing; expiresAt: number }>();

  /**
   * Marcos 2026-06-12: cheap title peek used by the QA review panel
   * to show "Publicación: <title>" next to a draft without paying
   * for a full ML round-trip per render. Returns null when the item
   * isn't in cache yet — the UI then falls back to the bare item id
   * + permalink.
   */
  peekCachedListingTitle(itemId: string): string | null {
    if (!itemId || typeof itemId !== 'string') return null;
    const hit = this.listingCache.get(itemId);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) return null;
    return hit.value?.title ?? null;
  }

  /** Marcos 2026-06-09 (urgent): the logística panel was timing out
   *  because every load re-fetched every shipment to discover its
   *  logistic_type / status. Cache the relevant subset by shipment
   *  id with a short TTL (env-tunable, default 120s). */
  private shipmentCache = new Map<
    string,
    {
      value: {
        logisticType: string | null;
        shippingMode: string | null;
        status: string | null;
        substatus: string | null;
      };
      expiresAt: number;
    }
  >();

  /**
   * Fetch listing metadata for a ML item, caching the resolved value
   * for `MERCADOLIBRE_LISTING_CACHE_TTL_MS` (default 5 min). Returns
   * null when the API is unreachable, the OAuth credential is missing,
   * or the item isn't found — callers (e.g. ClaudeService) must treat
   * a null as "no listing context for this turn" and proceed.
   *
   * Failure is non-fatal by design: the channel guardrail block has a
   * fallback line ("Para ese producto te conviene la publicación
   * específica. Buscala en nuestro perfil de tienda en MercadoLibre.")
   * that keeps the customer experience reasonable even without listing
   * data.
   */
  async fetchListingDetails(itemId: string): Promise<MercadoLibreListing | null> {
    if (!itemId || typeof itemId !== 'string') return null;

    const now = Date.now();
    const cached = this.listingCache.get(itemId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    // Marcos 2026-06-16: try cuenta 1 first, fall back to cuenta 2 on 403.
    // Listings sold under cuenta 2 reject cuenta 1's OAuth token, and
    // the result was the agent answering ML questions without any
    // publication context. The /items endpoint accepts either account's
    // token for that account's items, so we just try both before
    // giving up.
    const accounts: Array<'mercadolibre' | 'mercadolibre_cuenta2'> = [
      'mercadolibre',
      'mercadolibre_cuenta2',
    ];
    let auth: Awaited<ReturnType<typeof this.resolveAuthFor>> = null;
    let itemRes: Response | null = null;
    for (const which of accounts) {
      auth = await this.resolveAuthFor(which);
      if (!auth) continue;
      try {
        itemRes = await fetch(`${this.apiUrl}/items/${encodeURIComponent(itemId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        });
        if (itemRes.ok) break;
        if (itemRes.status === 403 || itemRes.status === 401) {
          // try the next account
          itemRes = null;
          continue;
        }
        break;
      } catch (err: any) {
        this.logger.warn(`Listing fetch ${itemId} (${which}) threw: ${err?.message}`);
        itemRes = null;
      }
    }
    if (!auth) {
      this.logger.warn(`Listing fetch ${itemId}: no MercadoLibre OAuth credentials`);
      return null;
    }

    try {
      if (!itemRes || !itemRes.ok) {
        this.logger.warn(`Listing fetch ${itemId}: items endpoint returned ${itemRes?.status ?? 'no response'} on all accounts`);
        return null;
      }
      const item: any = await itemRes.json();

      // Description is a separate ML endpoint — best-effort. Some
      // sellers leave it blank; that's fine.
      let descriptionPlain: string | null = null;
      try {
        const descRes = await fetch(
          `${this.apiUrl}/items/${encodeURIComponent(itemId)}/description`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${auth.accessToken}` },
          },
        );
        if (descRes.ok) {
          const desc: any = await descRes.json();
          if (typeof desc?.plain_text === 'string' && desc.plain_text.trim().length > 0) {
            descriptionPlain = desc.plain_text.trim();
          }
        }
      } catch {
        /* description is optional — never let it fail the whole fetch */
      }

      const attributes: Array<{ id: string; name: string; value: string }> =
        Array.isArray(item.attributes)
          ? item.attributes
              .map((a: any) => ({
                id: String(a?.id ?? ''),
                name: String(a?.name ?? a?.id ?? ''),
                value: String(a?.value_name ?? a?.value_id ?? ''),
              }))
              .filter((a: any) => a.id && a.value)
          : [];

      // Pick the first picture's HTTPS url, falling back to the
      // secure_thumbnail / thumbnail shortcuts ML offers on items that
      // weren't synced through the pictures array.
      const firstPic = Array.isArray(item.pictures) && item.pictures.length > 0
        ? item.pictures[0]
        : null;
      const thumbnailUrl: string | null =
        (typeof firstPic?.secure_url === 'string' && firstPic.secure_url) ||
        (typeof firstPic?.url === 'string' && firstPic.url) ||
        (typeof item.secure_thumbnail === 'string' && item.secure_thumbnail) ||
        (typeof item.thumbnail === 'string' && item.thumbnail) ||
        null;

      const listing: MercadoLibreListing = {
        itemId: String(item.id ?? itemId),
        title: typeof item.title === 'string' ? item.title : '',
        subtitle: typeof item.subtitle === 'string' ? item.subtitle : null,
        price: typeof item.price === 'number' ? item.price : null,
        currencyId: typeof item.currency_id === 'string' ? item.currency_id : null,
        availableQuantity:
          typeof item.available_quantity === 'number' ? item.available_quantity : null,
        condition: typeof item.condition === 'string' ? item.condition : null,
        permalink: typeof item.permalink === 'string' ? item.permalink : null,
        descriptionPlain,
        attributes,
        status: typeof item.status === 'string' ? item.status : null,
        thumbnailUrl,
      };

      const ttlMs = Number(process.env.MERCADOLIBRE_LISTING_CACHE_TTL_MS) || 5 * 60 * 1000;
      this.listingCache.set(itemId, { value: listing, expiresAt: now + ttlMs });
      this.logger.debug(`Listing fetched + cached: ${itemId} (${listing.title.slice(0, 50)})`);
      return listing;
    } catch (err: any) {
      this.logger.warn(`Listing fetch ${itemId} threw: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Marcos 2026-06-18 PM: búsqueda en TIEMPO REAL sobre las
   * publicaciones ACTIVAS de la cuenta ML. Sirve al typeahead "#" del
   * compositor del panel de QA — el operador tipea # + texto y le
   * traemos las publicaciones live de ML que matchean, no las del
   * catálogo TN (un link de TiendaNube pegado en una respuesta de ML
   * es falta grave de plataforma).
   *
   * Llama `/users/{user_id}/items/search?status=active&q=<texto>` con
   * paginación cortada a `limit` resultados — el typeahead muestra ~8
   * sugerencias, no necesitamos más. Hace el search en CADA cuenta
   * conectada (cuenta 1 + cuenta 2) y mezcla los resultados, así el
   * operador no tiene que pre-elegir cuenta.
   *
   * Para cada item id que devuelve la búsqueda, llamamos
   * fetchListingDetails (ya cacheado) para enriquecer con título +
   * permalink — ese es el dato que el operador necesita ver en el
   * dropdown para elegir.
   */
  /**
   * Marcos 2026-06-24: lista TODOS los itemIds activos de una cuenta
   * (o ambas). Pagina con offset hasta 100 páginas (5000 items cap
   * defensivo). Devuelve solo IDs — el caller (ingest-all-catalog)
   * los pasa al bulk-ingest. Mucho más eficiente que iterar items
   * uno por uno fetcheando ficha.
   */
  async listAllActiveItemIds(args: {
    accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2' | 'both';
  } = {}): Promise<Array<{ itemId: string; accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' }>> {
    const which: Array<'mercadolibre' | 'mercadolibre_cuenta2'> =
      args.accountKey === 'both' || args.accountKey == null
        ? ['mercadolibre', 'mercadolibre_cuenta2']
        : [args.accountKey];
    const out: Array<{ itemId: string; accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' }> = [];
    for (const ak of which) {
      const auth = await this.resolveAuthFor(ak);
      if (!auth) continue;
      let offset = 0;
      const limit = 50;
      const MAX_PAGES = 100;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${this.apiUrl}/users/${encodeURIComponent(auth.userId)}/items/search?status=active&limit=${limit}&offset=${offset}`;
        try {
          const res = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${auth.accessToken}` },
          });
          if (!res.ok) {
            this.logger.warn(`listAllActiveItemIds (${ak}) HTTP ${res.status} at offset ${offset}, stopping`);
            break;
          }
          const j: any = await res.json().catch(() => ({}));
          const arr = Array.isArray(j?.results) ? j.results : [];
          if (arr.length === 0) break;
          for (const id of arr) {
            if (typeof id === 'string' && /^MLA\d+$/i.test(id)) {
              out.push({ itemId: id.toUpperCase(), accountKey: ak });
            }
          }
          if (arr.length < limit) break;
          offset += limit;
        } catch (err: any) {
          this.logger.warn(`listAllActiveItemIds (${ak}) error at offset ${offset}: ${err.message}`);
          break;
        }
      }
    }
    this.logger.log(`listAllActiveItemIds: ${out.length} items across ${which.length} cuenta(s)`);
    return out;
  }

  async searchActiveListings(args: {
    q: string;
    limit?: number;
  }): Promise<Array<{ itemId: string; title: string; permalink: string; thumbnailUrl: string | null; accountKey: string }>> {
    const q = (args.q ?? '').trim();
    if (!q) return [];
    const limit = Math.max(1, Math.min(20, args.limit ?? 8));
    const accounts: Array<'mercadolibre' | 'mercadolibre_cuenta2'> = [
      'mercadolibre',
      'mercadolibre_cuenta2',
    ];
    const out: Array<{ itemId: string; title: string; permalink: string; thumbnailUrl: string | null; accountKey: string }> = [];
    for (const which of accounts) {
      const auth = await this.resolveAuthFor(which);
      if (!auth) continue;
      try {
        const url = `${this.apiUrl}/users/${encodeURIComponent(auth.userId)}/items/search?status=active&limit=${limit}&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        });
        if (!res.ok) {
          this.logger.warn(`ML active items search (${which}) returned ${res.status}`);
          continue;
        }
        const json: any = await res.json();
        const ids: string[] = Array.isArray(json?.results)
          ? json.results.map((x: any) => String(x)).filter(Boolean)
          : [];
        if (ids.length === 0) continue;
        // Enrich each id with title + permalink via fetchListingDetails
        // (cached). Cap at limit so we don't fan out 20 enrichments
        // when the operator only sees 8 options.
        const limited = ids.slice(0, limit);
        const enriched = await Promise.all(
          limited.map((id) => this.fetchListingDetails(id).catch(() => null)),
        );
        for (const e of enriched) {
          if (e && e.permalink) {
            out.push({
              itemId: e.itemId,
              title: e.title,
              permalink: e.permalink,
              thumbnailUrl: e.thumbnailUrl ?? null,
              accountKey: which,
            });
          }
        }
        // Early stop — if cuenta 1 ya devolvió suficientes resultados,
        // no consultamos cuenta 2 (la mayoría de las publicaciones
        // viven en cuenta 1; evitamos el round-trip extra).
        if (out.length >= limit) break;
      } catch (err: any) {
        this.logger.warn(`ML active items search (${which}) threw: ${err?.message ?? err}`);
      }
    }
    // Dedup by itemId — si por algún motivo la misma publicación
    // aparece en las dos cuentas (no debería, pero por las dudas).
    const seen = new Set<string>();
    return out.filter((r) => {
      if (seen.has(r.itemId)) return false;
      seen.add(r.itemId);
      return true;
    }).slice(0, limit);
  }

  /**
   * Fetch ML orders for the seller in a given date range. Marcos 2026-
   * 06-06 (Bloque C): the daily logistics Excel needs the day's ML
   * orders split by cuenta + by shipping mode (colecta vs flex vs
   * fulfillment). This pulls them straight from ML's /orders/search,
   * paginated, then bubbles them to the aggregator.
   *
   * `provider` defaults to 'mercadolibre' (existing single-cuenta
   * credential). When Marcos onboards the second cuenta as
   * `mercadolibre_cuenta2`, the aggregator passes that provider id
   * through and the resolver loads its credential transparently.
   *
   * Returns null when the auth resolves to nothing — caller treats
   * that as "this cuenta isn't connected yet" and emits an empty
   * section with a note instead of failing the whole aggregation.
   */
  async fetchOrdersForRange(args: {
    fromIso: string;
    toIso: string;
    provider?: string;
    limit?: number;
  }): Promise<{
    orders: Array<{
      id: string;
      orderNumber: string;
      buyerNickname: string | null;
      shippingMode: string | null;
      logisticType: string | null;
      shippingStatus: string | null;
      /** Marcos 2026-06-09: shipment substatus carries the in-transit
       *  signal for cross-docking shipments. Top-level status stays
       *  `ready_to_ship` until ML's hub stamps the final `shipped`,
       *  but `substatus=in_hub` already means "ML has the box, seller
       *  is done with it" — that's what the panel treats as dispatched. */
      shippingSubstatus: string | null;
      shippingId: string | null;
      /** Bloque B item 3.5 — Marcos 2026-06-08: pack id. ML
       *  groups multi-item carts into a single pack that ships
       *  together (1 box, 1 label). The daily aggregator
       *  collapses orders that share a packId into one row so
       *  the picker doesn't prepare the same cart N times. */
      packId: string | null;
      /** Marcos 2026-06-20: order-level status (paid / cancelled /
       *  invalid / payment_required / etc). Vista unificada lo usa
       *  para restar canceladas/inválidas del total mensual. */
      status: string | null;
      /** Bloque B item 4 — Marcos 2026-06-08: order total + currency
       *  for the ventas-unificadas dashboard. Both null when the
       *  order summary didn't include them. */
      totalAmount: number | null;
      currencyId: string | null;
      /** ISO timestamp ML stamped on the order creation. Used by
       *  per-day bucketing in the unified dashboard. */
      dateCreated: string | null;
      items: Array<{
        itemId: string;
        title: string;
        sku: string | null;
        quantity: number;
        unitPrice: number | null;
      }>;
    }>;
    sellerId: string;
  } | null> {
    const provider = args.provider ?? 'mercadolibre';

    // Marcos 2026-06-29 (perf): cache check antes de cualquier work.
    // Hit warm → ~5ms; miss → ~5-20s. TTL configurable via env.
    const ttlMs = (Number(process.env.MERCADOLIBRE_ORDERS_CACHE_TTL_SECONDS) || 60) * 1000;
    const cacheKey = `${provider}|${args.fromIso}|${args.toIso}|${args.limit ?? 50}`;
    const cached = this.ordersRangeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        orders: cached.value.orders as any,
        sellerId: cached.value.sellerId,
      };
    }

    const stored = await this.credentials.getFresh(
      provider,
      (refreshToken) => this.refreshAccessToken(refreshToken),
    );
    let accessToken: string | null = stored?.accessToken ?? null;
    let sellerId: string | null = stored?.externalId ?? null;
    if ((!accessToken || !sellerId) && provider === 'mercadolibre') {
      // Fallback to env credentials only for the primary cuenta —
      // the second cuenta has no env fallback by design.
      accessToken = this.fallbackAccessToken || accessToken;
      sellerId = this.fallbackUserId || sellerId;
    }
    if (!accessToken || !sellerId) return null;

    const perPage = Math.min(50, Math.max(1, args.limit ?? 50));
    const fromIso = encodeURIComponent(args.fromIso);
    const toIso = encodeURIComponent(args.toIso);
    // Marcos 2026-06-19 (vista unificada bugfix): default 20 páginas ×
    // 50/page = 1000 órdenes, capaz para el panel diario pero MUY
    // corto para "Ventas unificadas — este mes". Cuenta 1 corta
    // exactamente en 1000 y el total mensual sale subreportado. Subo
    // el default a 80 páginas (4000 órdenes ≈ 130/día × 30 días con
    // colchón). El .env lo puede bajar si Marcos quiere acotar
    // latencia.
    const maxPages = Number(process.env.MERCADOLIBRE_ORDERS_MAX_PAGES) || 80;

    // Marcos 2026-06-29 (perf): este loop era el ~95% del tiempo del
    // aggregator. Antes pagineaba secuencial — para 1200+ órdenes
    // eran ~24 round-trips × ~500ms cada uno = ~12s SOLO por cuenta.
    // Ahora fetcheamos page 0 primero (para saber el total), después
    // disparamos las páginas restantes en paralelo con batches de 8
    // (cap de concurrencia para no bursteear contra ML rate-limit).
    // Resultado esperado: ~24 round-trips secuenciales pasan a
    // 1 + ceil((N-1)/8) batches paralelos → de 12s a ~2-3s por cuenta.
    const buildUrl = (offset: number) =>
      `${this.apiUrl}/orders/search` +
      `?seller=${encodeURIComponent(sellerId)}` +
      `&order.date_created.from=${fromIso}` +
      `&order.date_created.to=${toIso}` +
      // Marcos 2026-06-09: ML's default sort is date_asc (oldest
      // first). Without an explicit sort the pagination cap eats
      // the OLDEST 1000 orders and the daily panel misses the
      // recent backlog Marcos is trying to prepare. Force date_desc
      // so the first pages always carry the freshest orders.
      `&sort=date_desc` +
      `&limit=${perPage}&offset=${offset}`;

    const fetchPage = async (offset: number): Promise<{ results: any[]; total: number } | null> => {
      const res = await fetch(buildUrl(offset), {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(
          `ML orders fetch (${provider}): HTTP ${res.status} at offset=${offset}`,
        );
        return null;
      }
      const json: any = await res.json().catch(() => ({}));
      const results = Array.isArray(json?.results) ? json.results : [];
      const total = Number(json?.paging?.total ?? results.length);
      return { results, total };
    };

    const ordersAcc: Array<any> = [];
    const firstPage = await fetchPage(0);
    if (!firstPage) {
      return { orders: [], sellerId };
    }
    ordersAcc.push(...firstPage.results);
    const totalAvailable = firstPage.total;
    const totalCap = Math.min(totalAvailable, maxPages * perPage);
    if (firstPage.results.length > 0 && firstPage.results.length < totalCap) {
      const remainingOffsets: number[] = [];
      for (let off = perPage; off < totalCap; off += perPage) {
        remainingOffsets.push(off);
      }
      const PARALLEL = 8;
      for (let i = 0; i < remainingOffsets.length; i += PARALLEL) {
        const batch = remainingOffsets.slice(i, i + PARALLEL);
        const pages = await Promise.all(batch.map((off) => fetchPage(off)));
        let earlyStop = false;
        for (const p of pages) {
          if (!p) { earlyStop = true; continue; }
          if (p.results.length === 0) { earlyStop = true; continue; }
          ordersAcc.push(...p.results);
        }
        // If any page came back empty/null we've gone past the end —
        // stop bursting more useless batches.
        if (earlyStop) break;
      }
    }

    const mapped = ordersAcc.map((o: any) => {
      const buyer = o?.buyer ?? {};
      const buyerNickname: string | null =
        (typeof buyer?.nickname === 'string' && buyer.nickname) ||
        ([buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') || null) ||
        null;
      const shipping = o?.shipping ?? {};
      const items = Array.isArray(o?.order_items)
        ? o.order_items.map((it: any) => ({
            itemId: String(it?.item?.id ?? ''),
            title: String(it?.item?.title ?? ''),
            sku:
              (typeof it?.item?.seller_sku === 'string' && it.item.seller_sku) ||
              (typeof it?.item?.seller_custom_field === 'string' &&
                it.item.seller_custom_field) ||
              null,
            quantity: Number(it?.quantity ?? 1),
            unitPrice: typeof it?.unit_price === 'number' ? it.unit_price : null,
          }))
        : [];
      return {
        id: String(o?.id ?? ''),
        orderNumber: String(o?.id ?? ''),
        buyerNickname,
        shippingMode: typeof shipping?.shipping_mode === 'string' ? shipping.shipping_mode : null,
        logisticType: typeof shipping?.logistic_type === 'string' ? shipping.logistic_type : null,
        shippingStatus: typeof shipping?.status === 'string' ? shipping.status : null,
        shippingSubstatus: typeof shipping?.substatus === 'string' ? shipping.substatus : null,
        shippingId: shipping?.id != null ? String(shipping.id) : null,
        packId: o?.pack_id != null ? String(o.pack_id) : null,
        // Marcos 2026-06-20: ML order.status (paid / cancelled /
        // invalid / payment_required / etc). Vista unificada lo usa
        // para restar las canceladas/inválidas del total.
        status: typeof o?.status === 'string' ? o.status : null,
        totalAmount: typeof o?.total_amount === 'number' ? o.total_amount : null,
        currencyId: typeof o?.currency_id === 'string' ? o.currency_id : null,
        dateCreated: typeof o?.date_created === 'string' ? o.date_created : null,
        items,
      };
    });

    // Marcos 2026-06-08: the /orders/search summary doesn't include
    // shipping.logistic_type, only shipping.id + shipping_mode. Without
    // logistic_type the daily Excel can't tell COLECTA vs FLEX apart
    // and every order falls into the COLECTA bucket. Fetch the
    // shipment per order to populate logistic_type. Cap concurrency
    // so we don't hammer ML when a day has dozens of orders.
    const concurrency = Number(process.env.MERCADOLIBRE_SHIPMENT_LOOKUP_CONCURRENCY) || 6;
    const cacheTtlMs =
      (Number(process.env.MERCADOLIBRE_SHIPMENT_CACHE_TTL_SECONDS) || 0) * 1000;
    // First pass: hydrate from cache so we don't queue a fetch for
    // shipments whose details are still warm.
    const nowMs = Date.now();
    const applyShipmentFields = (
      target: typeof mapped[number],
      v: { logisticType: string | null; shippingMode: string | null; status: string | null; substatus: string | null },
    ) => {
      if (v.logisticType) target.logisticType = v.logisticType;
      if (!target.shippingMode && v.shippingMode) target.shippingMode = v.shippingMode;
      if (!target.shippingStatus && v.status) target.shippingStatus = v.status;
      if (!target.shippingSubstatus && v.substatus) target.shippingSubstatus = v.substatus;
    };
    let cacheHits = 0;
    for (const m of mapped) {
      if (!m.shippingId) continue;
      const cached = this.shipmentCache.get(m.shippingId);
      if (cached && cached.expiresAt > nowMs) {
        applyShipmentFields(m, cached.value);
        cacheHits++;
      }
    }
    const queue = mapped.filter((m) => m.shippingId && !m.logisticType);
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const target = queue[cursor++];
        if (!target?.shippingId) continue;
        try {
          const shipmentUrl = `${this.apiUrl}/shipments/${target.shippingId}`;
          // 2026-06-08: ML's new shipment payload nests the logistic
          // data under `logistic: { mode, type, direction }`. Without
          // `x-format-new: true` the legacy keys `logistic_type` and
          // `shipping_mode` come back null and every order ends up
          // UNKNOWN → COLECTA, masking the flex split Marcos needs.
          const r = await fetch(shipmentUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-format-new': 'true',
            },
          });
          if (!r.ok) {
            this.logger.debug(
              `ML shipment lookup HTTP ${r.status} for ${target.shippingId} (order ${target.id}) — leaving logisticType null`,
            );
            continue;
          }
          const s: any = await r.json().catch(() => ({}));
          const value = {
            logisticType:
              (typeof s?.logistic?.type === 'string' && s.logistic.type) ||
              (typeof s?.logistic_type === 'string' && s.logistic_type) ||
              null,
            shippingMode:
              (typeof s?.logistic?.mode === 'string' && s.logistic.mode) ||
              (typeof s?.shipping_mode === 'string' && s.shipping_mode) ||
              null,
            status: typeof s?.status === 'string' ? s.status : null,
            substatus: typeof s?.substatus === 'string' ? s.substatus : null,
          };
          applyShipmentFields(target, value);
          if (cacheTtlMs > 0) {
            this.shipmentCache.set(target.shippingId, {
              value,
              expiresAt: Date.now() + cacheTtlMs,
            });
          }
        } catch (err: any) {
          this.logger.debug(
            `ML shipment lookup errored for ${target.shippingId}: ${err?.message ?? err}`,
          );
        }
      }
    };
    if (queue.length > 0) {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
      );
    }
    this.logger.debug(
      `ML shipment hydration: cache_hits=${cacheHits} fetched=${queue.length} (${provider})`,
    );

    this.logger.debug(
      `ML orders fetched (${provider}): seller=${sellerId} count=${mapped.length} shipments-resolved=${queue.length}`,
    );
    // Marcos 2026-06-29 (perf): guardamos el resultado final ya
    // procesado (mapped + shipments hydrated) — re-pegar la misma
    // ventana dentro del TTL es instantáneo.
    this.ordersRangeCache.set(cacheKey, {
      value: { orders: mapped as any[], sellerId },
      expiresAt: Date.now() + ttlMs,
    });
    return { orders: mapped, sellerId };
  }

  private mapStatus(status: string): MercadoLibreStatus {
    switch (status) {
      case 'UNANSWERED':
        return MercadoLibreStatus.UNANSWERED;
      case 'ANSWERED':
        return MercadoLibreStatus.ANSWERED;
      case 'CLOSED_UNANSWERED':
        return MercadoLibreStatus.CLOSED_UNANSWERED;
      case 'UNDER_REVIEW':
        return MercadoLibreStatus.UNDER_REVIEW;
      case 'BANNED':
        return MercadoLibreStatus.BANNED;
      default:
        return MercadoLibreStatus.UNANSWERED;
    }
  }
}
