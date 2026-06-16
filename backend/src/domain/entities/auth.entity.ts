/**
 * DOMAIN LAYER - Authentication Entities
 */

export enum UserRole {
  ADMIN = 'ADMIN',
  ATENCION = 'ATENCION',
  VENTAS = 'VENTAS',
  LOGISTICA = 'LOGISTICA',
}

export class AuthUser {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly username: string,
    public readonly name: string,
    public readonly role: UserRole,
    public readonly active: boolean,
  ) {}

  isAdmin(): boolean {
    return this.role === UserRole.ADMIN;
  }

  isAtencion(): boolean {
    return this.role === UserRole.ATENCION;
  }

  isVentas(): boolean {
    return this.role === UserRole.VENTAS;
  }

  isLogistica(): boolean {
    return this.role === UserRole.LOGISTICA;
  }

  canManageUsers(): boolean {
    return this.isAdmin();
  }

  canManageKnowledge(): boolean {
    return this.isAdmin() || this.isAtencion() || this.isVentas();
  }

  canViewConversations(): boolean {
    return true; // All roles can view conversations
  }

  canTakeOverConversation(): boolean {
    return this.isAdmin() || this.isAtencion();
  }
}

export class LoginCredentials {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {}

  validate(): boolean {
    return (
      this.email.length > 0 &&
      this.email.includes('@') &&
      this.password.length >= 6
    );
  }
}

export class AuthToken {
  constructor(
    public readonly accessToken: string,
    public readonly expiresIn: number,
  ) {}
}

/**
 * Stable code that the frontend switches on to render the right Spanish
 * message. Never leak details that help an attacker enumerate accounts —
 * `invalid_credentials` covers both "email not found" AND "password wrong"
 * with the same code and message.
 */
export type LoginFailureCode =
  | 'invalid_credentials'   // wrong email or password (intentionally generic)
  | 'account_deactivated'   // user exists but active=false
  | 'account_locked'        // per-account lockout after N failed attempts (Bloque C — Marcos 2026-06-06)
  | 'invalid_format'        // body validation failed pre-DB
  | 'internal_error';       // unhandled exception in the login pipeline

export class LoginResult {
  constructor(
    public readonly success: boolean,
    public readonly user: AuthUser | null,
    public readonly token: AuthToken | null,
    public readonly error: string | null,
    public readonly code: LoginFailureCode | null = null,
  ) {}

  static success(user: AuthUser, token: AuthToken): LoginResult {
    return new LoginResult(true, user, token, null, null);
  }

  static failure(error: string, code: LoginFailureCode = 'internal_error'): LoginResult {
    return new LoginResult(false, null, null, error, code);
  }
}
