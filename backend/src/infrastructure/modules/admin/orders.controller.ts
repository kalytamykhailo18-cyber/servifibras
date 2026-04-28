import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderManagementService } from '../../../adapters/admin/order-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { OrderStatus } from '@prisma/client';

@Controller('admin/orders')
@UseGuards(AuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orderManagement: OrderManagementService) {}

  // Get order statistics (must be before :id route)
  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS)
  async getOrderStatistics() {
    const data = await this.orderManagement.getOrderStatistics();
    return { success: true, data };
  }

  // List orders with filters
  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS)
  async listOrders(
    @Query('status') status?: OrderStatus,
    @Query('contactId') contactId?: string,
    @Query('orderNumber') orderNumber?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.orderManagement.listOrders({
      status,
      contactId,
      orderNumber,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    return { success: true, ...result };
  }

  // Get order by ID
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS)
  async getOrderById(@Param('id') id: string) {
    const data = await this.orderManagement.getOrderById(id);

    if (!data) {
      return { success: false, error: 'Order not found' };
    }

    return { success: true, data };
  }

  // Create new order
  @Post()
  @Roles(UserRole.ADMIN, 'VENTAS' as any)
  async createOrder(@Body() body: any) {
    const data = await this.orderManagement.createOrder(body);
    return { success: true, data };
  }

  // Update order
  @Put(':id')
  @Roles(UserRole.ADMIN, 'VENTAS' as any, 'LOGISTICA' as any)
  async updateOrder(@Param('id') id: string, @Body() body: any) {
    const data = await this.orderManagement.updateOrder(id, body);

    if (!data) {
      return { success: false, error: 'Order not found' };
    }

    return { success: true, data };
  }

  // Delete order
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteOrder(@Param('id') id: string) {
    const success = await this.orderManagement.deleteOrder(id);
    return { success };
  }

  // Update order status
  @Put(':id/status')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS)
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: OrderStatus },
  ) {
    const success = await this.orderManagement.updateOrderStatus(
      id,
      body.status,
    );
    return { success };
  }

  // Update tracking info
  @Put(':id/tracking')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async updateTrackingInfo(
    @Param('id') id: string,
    @Body() body: { trackingNumber: string; carrier: string },
  ) {
    const success = await this.orderManagement.updateTrackingInfo(id, body);
    return { success };
  }
}
