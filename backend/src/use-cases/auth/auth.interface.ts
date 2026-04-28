/**
 * USE CASES LAYER - Authentication Service Interface
 */

import { AuthUser, LoginCredentials, LoginResult } from '../../domain/entities/auth.entity';

export interface IAuthService {
  /**
   * Authenticate user with email and password
   */
  login(credentials: LoginCredentials): Promise<LoginResult>;

  /**
   * Validate JWT token and return user
   */
  validateToken(token: string): Promise<AuthUser | null>;

  /**
   * Hash password for storage
   */
  hashPassword(password: string): Promise<string>;

  /**
   * Verify password against hash
   */
  verifyPassword(password: string, hash: string): Promise<boolean>;

  /**
   * Generate JWT token for user
   */
  generateToken(user: AuthUser): string;
}
