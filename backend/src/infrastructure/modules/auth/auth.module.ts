/**
 * INFRASTRUCTURE LAYER - Auth Module
 * Wires up authentication service, guards, and controller
 */

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from '../../../adapters/auth/auth.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard } from '../../guards/roles.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
