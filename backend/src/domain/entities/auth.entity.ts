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

export class LoginResult {
  constructor(
    public readonly success: boolean,
    public readonly user: AuthUser | null,
    public readonly token: AuthToken | null,
    public readonly error: string | null,
  ) {}

  static success(user: AuthUser, token: AuthToken): LoginResult {
    return new LoginResult(true, user, token, null);
  }

  static failure(error: string): LoginResult {
    return new LoginResult(false, null, null, error);
  }
}
