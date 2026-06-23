/**
 * ADAPTERS LAYER - Authentication Service
 * Handles JWT token generation, password hashing, and user authentication
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, UserRole as PrismaUserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { IAuthService } from '../../use-cases/auth/auth.interface';
import {
  AuthUser,
  LoginCredentials,
  LoginResult,
  AuthToken,
  UserRole,
} from '../../domain/entities/auth.entity';

const REFRESH_BYTES = 48; // 384 bits — plenty of entropy for a refresh token

function hashToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

function refreshTtlSeconds(): number {
  const raw = process.env.REFRESH_TOKEN_EXPIRES_IN_SEC;
  const n = raw != null ? Number(raw) : 7 * 24 * 60 * 60; // 7 days
  return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60;
}

export interface IssuedTokenPair {
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string;          // raw — return to caller exactly once
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class AuthService implements IAuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly prisma: PrismaClient;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly saltRounds = 10;

  constructor() {
    this.prisma = new PrismaClient();
    this.jwtSecret = process.env.JWT_SECRET || 'servifibras-secret-change-in-production';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';

    if (!process.env.JWT_SECRET) {
      this.logger.warn('⚠️  JWT_SECRET not configured. Using default (not secure for production)');
      this.logger.warn('   Add JWT_SECRET to .env for production');
    }

    this.logger.log('✅ Auth service initialized');
  }

  async login(credentials: LoginCredentials): Promise<LoginResult> {
    try {
      if (!credentials.validate()) {
        return LoginResult.failure('Email o contraseña incorrectos.', 'invalid_format');
      }

      this.logger.debug(`Login attempt for: ${credentials.email}`);

      // Find user by email. Note: we deliberately use the same error code
      // ("invalid_credentials") for "no such email" and "wrong password" so
      // an attacker can't enumerate which emails are registered.
      const dbUser = await this.prisma.user.findUnique({
        where: { email: credentials.email },
      });

      if (!dbUser) {
        this.logger.debug(`User not found: ${credentials.email}`);
        return LoginResult.failure(
          'Email o contraseña incorrectos.',
          'invalid_credentials',
        );
      }

      // Per-account lockout (Bloque C — security gap #9, Marcos 2026-
      // 06-06). Checked BEFORE the password compare so a locked
      // account doesn't keep ticking the failed-attempts counter and
      // the lockout window holds firm. The error message includes a
      // human-readable cooldown so the legit user understands what
      // happened — bad actors get the same surface, which is fine.
      //
      // ACCOUNT_LOCKOUT_ENABLED=false disables the whole thing — used
      // by the E2E sweep where multiple tests do wrong-password
      // attempts on the same seed users and would otherwise self-DOS
      // mid-run. Production keeps the default (enabled).
      const lockoutEnabled = (process.env.ACCOUNT_LOCKOUT_ENABLED ?? 'true').toLowerCase() !== 'false';
      if (lockoutEnabled && dbUser.lockedUntil && dbUser.lockedUntil.getTime() > Date.now()) {
        const minutesLeft = Math.max(
          1,
          Math.ceil((dbUser.lockedUntil.getTime() - Date.now()) / 60000),
        );
        this.logger.warn(
          `Account locked: ${dbUser.email} (until ${dbUser.lockedUntil.toISOString()})`,
        );
        return LoginResult.failure(
          `Cuenta bloqueada temporalmente por intentos fallidos. Probá de nuevo en ~${minutesLeft} min, o pedile al administrador que la desbloquee.`,
          'account_locked',
        );
      }

      // Verify password BEFORE checking active. If we checked active first
      // and revealed the deactivated state to anyone hitting the endpoint,
      // we'd leak that the email is a valid account. Verifying password
      // first keeps the deactivated path behind a successful auth check.
      const isPasswordValid = await this.verifyPassword(
        credentials.password,
        dbUser.password,
      );

      if (!isPasswordValid) {
        this.logger.debug(`Invalid password for: ${credentials.email}`);
        // Bump the per-account failed-attempt counter. If we cross the
        // threshold within the rolling window, stamp the lockout. The
        // lockout is intentionally distinct from the IP-level throttle:
        // an attacker rotating IPs hits the per-account ceiling and
        // gets frozen out for the cooldown anyway. Disabled when
        // ACCOUNT_LOCKOUT_ENABLED=false.
        if (lockoutEnabled) {
          await this.recordFailedLogin(dbUser.id, dbUser.failedLoginAttempts, dbUser.lastFailedLoginAt);
        }
        return LoginResult.failure(
          'Email o contraseña incorrectos.',
          'invalid_credentials',
        );
      }

      // Now that the caller proved they own the credentials, we can tell
      // them the account is deactivated — this only reaches a legitimate
      // user, not a credential-stuffing attacker.
      if (!dbUser.active) {
        this.logger.debug(`Login blocked: user ${dbUser.id} is deactivated`);
        return LoginResult.failure(
          'Tu cuenta está desactivada. Contactá al administrador para reactivarla.',
          'account_deactivated',
        );
      }

      // Reset the lockout counters on a successful login. Idempotent
      // — the no-op case (counter already 0) is a single equality
      // check on the prisma side.
      if (
        dbUser.failedLoginAttempts > 0 ||
        dbUser.lockedUntil != null ||
        dbUser.lastFailedLoginAt != null
      ) {
        await this.prisma.user
          .update({
            where: { id: dbUser.id },
            data: {
              failedLoginAttempts: 0,
              lockedUntil: null,
              lastFailedLoginAt: null,
            },
          })
          .catch((err: any) => {
            this.logger.warn(`Reset lockout counters failed for ${dbUser.email}: ${err.message}`);
          });
      }

      // Create auth user entity
      const user = new AuthUser(
        dbUser.id,
        dbUser.email,
        dbUser.username,
        dbUser.name,
        this.mapRole(dbUser.role),
        dbUser.active,
      );

      // Generate JWT token
      const tokenString = this.generateToken(user);
      const token = new AuthToken(tokenString, 86400); // 24 hours in seconds

      this.logger.log(`✅ User logged in: ${user.email} (${user.role})`);

      return LoginResult.success(user, token);
    } catch (error: any) {
      this.logger.error(`Login error: ${error.message}`);
      return LoginResult.failure(
        'No se pudo procesar el inicio de sesión. Probá de nuevo.',
        'internal_error',
      );
    }
  }

  async validateToken(token: string): Promise<AuthUser | null> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;

      if (!decoded.userId || !decoded.email || !decoded.role) {
        return null;
      }

      // Verify user still exists in database
      const dbUser = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!dbUser) {
        return null;
      }

      // Reject deactivated users immediately — admin Users page can flip
      // `active=false` and we don't want a stale JWT to keep working for
      // up to 15 minutes against role-gated endpoints. The refresh-token
      // path also rejects on `!user.active`, so the user is fully locked
      // out the moment they're deactivated.
      if (!dbUser.active) {
        this.logger.debug(`Token rejected: user ${dbUser.id} is deactivated`);
        return null;
      }

      return new AuthUser(
        decoded.userId,
        decoded.email,
        decoded.username || dbUser.username,
        decoded.name,
        decoded.role as UserRole,
        dbUser.active,
      );
    } catch (error: any) {
      this.logger.debug(`Token validation failed: ${error.message}`);
      return null;
    }
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateToken(user: AuthUser): string {
    const payload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      // Random jti so each issuance is byte-unique even when the previous
      // one was emitted in the same second. Lets clients/audit logs track
      // distinct sessions and rotations without ambiguity.
      jti: crypto.randomBytes(8).toString('hex'),
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn as string,
    } as jwt.SignOptions);
  }

  /**
   * Bump the per-account failed-login counter and stamp a lockout if
   * the counter crosses ACCOUNT_LOCKOUT_THRESHOLD within
   * ACCOUNT_LOCKOUT_WINDOW_MIN. The "window" rule is important — a
   * forgetful user typing the wrong password three days apart should
   * NOT have those count together against a lockout, so we reset the
   * counter to 1 if the last failed attempt is older than the window.
   *
   * Env knobs (all optional, with safe production defaults):
   *   ACCOUNT_LOCKOUT_THRESHOLD       — failures allowed before lockout (default 5)
   *   ACCOUNT_LOCKOUT_WINDOW_MIN      — rolling window for counting failures (default 10)
   *   ACCOUNT_LOCKOUT_DURATION_MIN    — how long the lockout holds (default 15)
   *
   * Marcos's security checklist 2026-06-06 (item 9). Layer above the
   * IP-level throttle — an attacker with rotating IPs still gets
   * frozen out per account, which is exactly the gap the existing
   * throttler couldn't close.
   */
  /**
   * Idle-session enforcement (Bloque C — security gap #10, Marcos
   * 2026-06-06). Called on every authenticated request via AuthGuard.
   * Returns 'idle_expired' when the user has been inactive longer
   * than SESSION_IDLE_TIMEOUT_MIN; otherwise updates lastActiveAt
   * (debounced) and returns 'ok'. The debounce window
   * (SESSION_IDLE_TOUCH_DEBOUNCE_SEC, default 60) keeps the write
   * load proportional to the user count, not to every API call.
   *
   * `SESSION_IDLE_ENABLED=false` turns the check off entirely — used
   * in dev by default so the E2E sweep doesn't fight the timer. Prod
   * leaves it unset (defaults true).
   */
  async touchActivity(userId: string): Promise<'ok' | 'idle_expired'> {
    const enabled = (process.env.SESSION_IDLE_ENABLED ?? 'true').toLowerCase() !== 'false';
    if (!enabled) return 'ok';

    const timeoutMin = Number(process.env.SESSION_IDLE_TIMEOUT_MIN) || 60;
    const debounceSec = Number(process.env.SESSION_IDLE_TOUCH_DEBOUNCE_SEC) || 60;
    const now = new Date();

    // Single round-trip: read lastActiveAt + write if past the
    // debounce window. We accept a slightly stale read (no
    // transaction) — the idle check is best-effort security, not
    // bank-grade accounting.
    let row;
    try {
      row = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { lastActiveAt: true, active: true },
      });
    } catch (err: any) {
      this.logger.warn(`touchActivity read failed for ${userId.slice(0, 8)}: ${err.message}`);
      return 'ok';
    }
    if (!row) return 'ok'; // user vanished — let the validateToken path handle it
    if (row.active === false) return 'ok'; // deactivation is handled elsewhere

    const lastActive = row.lastActiveAt;
    if (lastActive != null) {
      const idleMs = now.getTime() - lastActive.getTime();
      if (idleMs > timeoutMin * 60_000) {
        this.logger.warn(
          `Idle session: user=${userId.slice(0, 8)} idle=${Math.round(idleMs / 60_000)}min > ${timeoutMin}min — bouncing to login`,
        );
        return 'idle_expired';
      }
    }

    // Debounced touch: only write if the previous timestamp is older
    // than the debounce window. First-ever request writes too (the
    // null case).
    const shouldWrite =
      lastActive == null || now.getTime() - lastActive.getTime() > debounceSec * 1000;
    if (shouldWrite) {
      void this.prisma.user
        .update({ where: { id: userId }, data: { lastActiveAt: now } })
        .catch((err: any) => {
          this.logger.warn(`touchActivity write failed for ${userId.slice(0, 8)}: ${err.message}`);
        });
    }
    return 'ok';
  }

  private async recordFailedLogin(
    userId: string,
    prevAttempts: number,
    prevLastAt: Date | null,
  ): Promise<void> {
    const threshold = Number(process.env.ACCOUNT_LOCKOUT_THRESHOLD) || 5;
    const windowMin = Number(process.env.ACCOUNT_LOCKOUT_WINDOW_MIN) || 10;
    const durationMin = Number(process.env.ACCOUNT_LOCKOUT_DURATION_MIN) || 15;
    const now = new Date();

    // If the last failure is older than the rolling window, treat
    // this as a fresh start — count = 1, no carryover from days ago.
    const withinWindow =
      prevLastAt != null && now.getTime() - prevLastAt.getTime() < windowMin * 60_000;
    const nextAttempts = withinWindow ? prevAttempts + 1 : 1;

    const reachedLockout = nextAttempts >= threshold;
    const lockedUntil = reachedLockout ? new Date(now.getTime() + durationMin * 60_000) : null;

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: nextAttempts,
          lastFailedLoginAt: now,
          ...(reachedLockout ? { lockedUntil } : {}),
        },
      });
      if (reachedLockout) {
        this.logger.warn(
          `Account lockout triggered: user=${userId.slice(0, 8)} attempts=${nextAttempts} until=${lockedUntil!.toISOString()}`,
        );
      } else {
        this.logger.debug(
          `Failed-login counter: user=${userId.slice(0, 8)} attempts=${nextAttempts}/${threshold} (window ${windowMin}min)`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`recordFailedLogin update failed for user ${userId.slice(0, 8)}: ${err.message}`);
    }
  }

  private mapRole(prismaRole: PrismaUserRole): UserRole {
    switch (prismaRole) {
      case PrismaUserRole.ADMIN:
        return UserRole.ADMIN;
      case PrismaUserRole.ATENCION:
        return UserRole.ATENCION;
      case PrismaUserRole.VENTAS:
        return UserRole.VENTAS;
      case PrismaUserRole.LOGISTICA:
        return UserRole.LOGISTICA;
      // Marcos 2026-06-23: faltaba el case ENCARGADO — caía al default
      // y se mapeaba a ATENCION. Aldo (role=ENCARGADO en DB) entraba
      // con un JWT que decía ATENCION, así que los gates de Pedidos /
      // PRFV / Armado que checkean ENCARGADO explícito nunca pasaban.
      // El auto-expand del RolesGuard tampoco se disparaba para esas
      // surfaces porque LOGISTICA no estaba en su set.
      case PrismaUserRole.ENCARGADO:
        return UserRole.ENCARGADO;
      default:
        return UserRole.ATENCION; // Default to ATENCION for unknown roles
    }
  }

  /**
   * Issue a refresh token for a user, optionally chained to a previous one
   * (rotation). Returns the raw token value — caller MUST return it to the
   * client exactly once; we only persist a hash.
   *
   *   `family` groups all rotated tokens for one device login. New login →
   *   new family. Refresh → same family, new id.
   */
  async issueRefreshToken(userId: string, family?: string): Promise<{ raw: string; expiresAt: Date; family: string }> {
    const raw = crypto.randomBytes(REFRESH_BYTES).toString('base64url');
    const tokenHash = hashToken(raw);
    const fam = family ?? crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + refreshTtlSeconds() * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, family: fam, expiresAt },
    });

    return { raw, expiresAt, family: fam };
  }

  /**
   * Issue an access + refresh pair. Use on initial login.
   */
  async issueTokenPair(user: AuthUser): Promise<IssuedTokenPair> {
    const accessToken = this.generateToken(user);
    // Mirror jwt.sign expiresIn ('24h', '15m', etc.) into seconds for the
    // response. Keeping the fallback simple — the client really only needs
    // a hint, the JWT itself is authoritative.
    const accessTokenExpiresIn = parseExpiresInToSeconds(this.jwtExpiresIn);
    const refresh = await this.issueRefreshToken(user.id);
    return {
      accessToken,
      accessTokenExpiresIn,
      refreshToken: refresh.raw,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  /**
   * Rotate a refresh token: validate the presented one, mark it revoked,
   * issue a fresh refresh in the same family + a new access JWT.
   *
   * Theft detection: if the presented token was already revoked (i.e.
   * someone is reusing an old token), revoke the entire family. The
   * legitimate session will fail its next refresh and the user re-logs.
   *
   * Returns null on any failure (expired, unknown, revoked-already-handled).
   */
  async rotateRefreshToken(rawRefreshToken: string): Promise<IssuedTokenPair | null> {
    const tokenHash = hashToken(rawRefreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!row) return null;

    // Reuse-after-revoke = stolen token signal. Revoke the family.
    if (row.revokedAt) {
      this.logger.warn(`Refresh token reuse detected for family ${row.family}; revoking family`);
      await this.prisma.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    if (row.expiresAt.getTime() < Date.now()) {
      return null;
    }

    if (!row.user || !row.user.active) {
      return null;
    }

    const user = new AuthUser(
      row.user.id,
      row.user.email,
      row.user.username,
      row.user.name,
      this.mapRole(row.user.role),
      row.user.active,
    );

    // Issue new pair in the same family
    const newRefresh = await this.issueRefreshToken(row.userId, row.family);
    const newRow = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(newRefresh.raw) },
      select: { id: true },
    });
    // Mark presented token revoked + chain to its replacement
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedById: newRow?.id ?? null },
    });

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      accessTokenExpiresIn: parseExpiresInToSeconds(this.jwtExpiresIn),
      refreshToken: newRefresh.raw,
      refreshTokenExpiresAt: newRefresh.expiresAt,
    };
  }

  /**
   * Logout: revoke the presented refresh token and its entire family. The
   * access JWT is still valid until it expires (we'd need a token blacklist
   * for instant access-token revocation; deferred until access TTL is
   * shortened).
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { family: true },
    });
    if (!row) return;
    await this.prisma.refreshToken.updateMany({
      where: { family: row.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}

/**
 * Parse the ms-style token expiry string ('24h', '15m', '3600s') into
 * seconds. Defaults to 24h if the input can't be parsed — matches the
 * existing behaviour of the AuthToken constructor.
 */
function parseExpiresInToSeconds(value: string): number {
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());
  if (!m) return 86400;
  const n = Number(m[1]);
  const u = (m[2] || 's').toLowerCase();
  const mult = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return n * (mult[u as keyof typeof mult] ?? 1);
}
