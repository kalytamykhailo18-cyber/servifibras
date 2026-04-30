import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';

const prisma = new PrismaClient();

@Controller('admin/users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  // List active users — used by lead/conversation "assign to" selects.
  // Excludes the bcrypt password hash from the response shape.
  @Get()
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA)
  async listUsers() {
    const users = await prisma.user.findMany({
      where: { active: true },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: users };
  }
}
