/**
 * ADAPTERS LAYER — File-share signed URLs.
 *
 * Operators sometimes need to send a PDF (or any uploaded file) to a customer
 * over a channel that doesn't support native document attachments (TiendaNube
 * webchat / FB DM today, until we wire each provider's media API). The
 * fallback we use is "send the message text + a public download link" — but
 * the file lives under `/admin/uploads/...` which is JWT-gated, so we mint a
 * short-lived HMAC-signed token that maps to a public route the customer can
 * fetch without auth.
 *
 * Token shape: `<base64url(payload)>.<base64url(hmac-sha256(payload, secret))>`
 *   payload = JSON({ p: relative-key, n: filename, exp: unix-seconds })
 *
 * Why HMAC instead of a DB row: this is a one-shot link, no revocation
 * needed beyond TTL, and a row-per-share table would just add bookkeeping
 * for the same security guarantees. If Marcos ever asks for "kill this
 * link" we'd switch to a row-backed implementation.
 *
 * `.env` knobs:
 *   FILE_SHARE_SECRET           — HMAC key. Falls back to JWT_SECRET (which
 *                                 we already require), so out of the box on
 *                                 a configured deployment it Just Works.
 *   FILE_SHARE_TTL_SECONDS      — link lifetime (default 7 days).
 *   PUBLIC_BACKEND_URL          — base URL the customer reaches us at.
 *                                 Required for share links to be useful.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface SignedPayload {
  p: string; // relative key under uploads root
  n: string; // user-facing filename (kept for content-disposition)
  exp: number; // unix seconds
}

export interface FileShareLink {
  token: string;
  url: string;
  expiresAt: Date;
}

@Injectable()
export class FileShareService {
  private readonly logger = new Logger(FileShareService.name);
  private warnedMissingSecret = false;

  private secret(): string {
    const v = process.env.FILE_SHARE_SECRET;
    if (v && v.length > 0) return v;
    const fallback = process.env.JWT_SECRET;
    if (fallback && fallback.length > 0) {
      if (!this.warnedMissingSecret) {
        this.warnedMissingSecret = true;
        this.logger.warn(
          'FILE_SHARE_SECRET not set — using JWT_SECRET as fallback. Set a dedicated FILE_SHARE_SECRET in .env so file-share signing survives JWT rotations.',
        );
      }
      return fallback;
    }
    throw new Error('FILE_SHARE_SECRET (or JWT_SECRET fallback) is not configured');
  }

  private ttl(): number {
    const raw = process.env.FILE_SHARE_TTL_SECONDS;
    const n = raw != null && raw !== '' ? Number(raw) : 7 * 24 * 60 * 60;
    return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60;
  }

  private baseUrl(): string {
    const raw = process.env.PUBLIC_BACKEND_URL;
    if (raw && raw.trim().length > 0) {
      return raw.trim().replace(/\/$/, '');
    }
    this.logger.warn(
      'PUBLIC_BACKEND_URL not set — share links will be relative and likely unreachable for customers. Set it in .env.',
    );
    return '';
  }

  /**
   * Mint a token + ready-to-share URL for a stored file. `relativeKey` must
   * be the "yyyy/mm/uuid.ext" path under UPLOADS_DIR (not the
   * `/admin/uploads/...` URL). `displayName` is what the browser will save
   * the file as.
   */
  sign(relativeKey: string, displayName: string): FileShareLink {
    const exp = Math.floor(Date.now() / 1000) + this.ttl();
    const payload: SignedPayload = { p: relativeKey, n: displayName, exp };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.secret())
      .update(payloadB64)
      .digest('base64url');
    const token = `${payloadB64}.${sig}`;
    const base = this.baseUrl();
    return {
      token,
      url: base ? `${base}/p/file/${token}` : `/p/file/${token}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /**
   * Validate a token and return the embedded path/name. Returns null on any
   * tampering, malformation, or expiry.
   */
  verify(token: string): { relativeKey: string; displayName: string } | null {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const dotIndex = token.indexOf('.');
    const payloadB64 = token.slice(0, dotIndex);
    const sig = token.slice(dotIndex + 1);
    if (!payloadB64 || !sig) return null;

    let expected: string;
    try {
      expected = crypto
        .createHmac('sha256', this.secret())
        .update(payloadB64)
        .digest('base64url');
    } catch (err: any) {
      this.logger.error(`HMAC compute failed: ${err.message}`);
      return null;
    }
    if (sig.length !== expected.length) return null;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    } catch {
      return null;
    }

    let parsed: SignedPayload;
    try {
      parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (
      !parsed ||
      typeof parsed.p !== 'string' ||
      typeof parsed.n !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (parsed.p.includes('..') || parsed.p.startsWith('/')) return null;
    return { relativeKey: parsed.p, displayName: parsed.n };
  }
}
