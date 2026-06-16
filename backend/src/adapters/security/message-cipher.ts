/**
 * ADAPTERS LAYER — Message-content cipher for at-rest encryption.
 *
 * Wraps AES-256-GCM with a project-wide 32-byte key sourced from
 * `CONVERSATION_ENCRYPTION_KEY` (.env). Encryption is OPTIONAL — when the
 * key is absent the helpers pass plaintext through unchanged so dev,
 * tests, and the legacy DB rows that pre-date this feature keep working.
 *
 * Wire format:
 *   enc:v1:<base64(iv-12B)>:<base64(ciphertext + 16B tag)>
 *
 *   - `enc:v1` is a sentinel so reads can detect ciphertext vs. legacy
 *     plaintext on the same column without a schema migration. New
 *     rows are encrypted; old rows stay readable until they're rewritten.
 *   - `:` separator can't collide with base64.
 *   - GCM tag is appended to the ciphertext blob, not stored separately.
 *
 * Key rotation is out of scope for v1 — version-suffix `v1` lets us
 * introduce `enc:v2:...` later without breaking existing rows.
 *
 * The class is a static-singleton-style injector via `MessageCipher.shared`
 * so callers that already create their own `new PrismaClient()` (which is
 * the prevailing pattern in this codebase) can call `MessageCipher.shared`
 * without wiring through Nest DI.
 */

import * as crypto from 'node:crypto';

const SENTINEL = 'enc:v1:';
const TAG_LEN = 16;
const IV_LEN = 12;

export class MessageCipher {
  private readonly key: Buffer | null;
  private readonly enabled: boolean;

  constructor(rawKey?: string) {
    const k = rawKey ?? process.env.CONVERSATION_ENCRYPTION_KEY ?? '';
    if (k.length === 0) {
      this.key = null;
      this.enabled = false;
      return;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(k, 'base64');
    } catch {
      throw new Error('CONVERSATION_ENCRYPTION_KEY must be valid base64');
    }
    if (buf.length !== 32) {
      throw new Error(
        `CONVERSATION_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`,
      );
    }
    this.key = buf;
    this.enabled = true;
  }

  /** True iff a key is configured and encryption will actually run. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Encrypt a plaintext string. With no key configured, returns the input
   * unchanged. Empty / null inputs pass through.
   */
  encrypt(plain: string | null | undefined): string {
    if (!plain) return plain ?? '';
    if (!this.enabled || !this.key) return plain;
    if (plain.startsWith(SENTINEL)) return plain; // already encrypted
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SENTINEL}${iv.toString('base64')}:${Buffer.concat([enc, tag]).toString('base64')}`;
  }

  /**
   * Decrypt a stored value. Plaintext (no sentinel) passes through — this
   * is what keeps legacy rows readable. On any decryption failure (wrong
   * key, corrupted blob, bad tag) we return the original value so the UI
   * doesn't blank out — operators will see "<encrypted>"-like garbage,
   * which is the correct signal that the key is wrong/missing rather
   * than silently dropping content.
   */
  decrypt(value: string | null | undefined): string {
    if (!value) return value ?? '';
    if (!value.startsWith(SENTINEL)) return value;
    if (!this.enabled || !this.key) return value;
    try {
      const rest = value.slice(SENTINEL.length);
      const [ivB64, cipherB64] = rest.split(':');
      if (!ivB64 || !cipherB64) return value;
      const iv = Buffer.from(ivB64, 'base64');
      const all = Buffer.from(cipherB64, 'base64');
      if (all.length < TAG_LEN) return value;
      const tag = all.subarray(all.length - TAG_LEN);
      const enc = all.subarray(0, all.length - TAG_LEN);
      const dec = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      dec.setAuthTag(tag);
      return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
    } catch {
      return value;
    }
  }

  /** Reset the singleton — only used in tests when the env key changes. */
  static reset(): void {
    _shared = null;
  }
}

// Lazy singleton so the env is read on first use, not at module import. Lets
// tests temporarily set the env var, call `MessageCipher.reset()`, and
// re-acquire a fresh instance bound to the new key.
let _shared: MessageCipher | null = null;
export function getMessageCipher(): MessageCipher {
  if (!_shared) _shared = new MessageCipher();
  return _shared;
}
(MessageCipher as any).shared = new Proxy({} as MessageCipher, {
  get(_t, prop) { return (getMessageCipher() as any)[prop]; },
});
