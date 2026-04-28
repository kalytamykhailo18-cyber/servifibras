/**
 * ADAPTERS LAYER - Authentication Service
 * Handles JWT token generation, password hashing, and user authentication
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, UserRole as PrismaUserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { IAuthService } from '../../use-cases/auth/auth.interface';
import {
  AuthUser,
  LoginCredentials,
  LoginResult,
  AuthToken,
  UserRole,
} from '../../domain/entities/auth.entity';

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
        return LoginResult.failure('Invalid credentials format');
      }

      this.logger.debug(`Login attempt for: ${credentials.email}`);

      // Find user by email
      const dbUser = await this.prisma.user.findUnique({
        where: { email: credentials.email },
      });

      if (!dbUser) {
        this.logger.debug(`User not found: ${credentials.email}`);
        return LoginResult.failure('Invalid email or password');
      }

      // Verify password
      const isPasswordValid = await this.verifyPassword(
        credentials.password,
        dbUser.password,
      );

      if (!isPasswordValid) {
        this.logger.debug(`Invalid password for: ${credentials.email}`);
        return LoginResult.failure('Invalid email or password');
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
      return LoginResult.failure('Authentication failed');
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
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn as string,
    } as jwt.SignOptions);
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
      default:
        return UserRole.ATENCION; // Default to ATENCION for unknown roles
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
