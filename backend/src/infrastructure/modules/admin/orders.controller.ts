import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Request,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { OrderManagementService } from '../../../adapters/admin/order-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { OrderStatus } from '@prisma/client';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/orders')
@UseGuards(AuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly orderManagement: OrderManagementService,
    private readonly audit: AuditLogService,
  ) {}

  /** Helper — pull ip + UA off the request for audit-log entries. */
  private auditCtx(req: any): { ip: string | null; userAgent: string | null } {
    const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
    const userAgent = (req?.headers?.['user-agent'] as string) || null;
    return { ip, userAgent };
  }

  // Get order statistics (must be before :id route)
  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async getOrderStatistics() {
    const data = await this.orderManagement.getOrderStatistics();
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-12: list manual + TN orders that have been armed
   * but not yet invoiced. Declared above @Get(':id') so the static
   * "pending-invoicing" segment isn't swallowed by the dynamic
   * route. The operator works through this list, ticking each one
   * off as the billing system catches up.
   */
  @Get('pending-invoicing')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION)
  async listPendingInvoicing() {
    const data = await this.orderManagement.listPendingInvoicing();
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-18: DEVOLUCION rows whose package hasn't physically
   * been brought back yet. Static segment declared above @Get(':id') so
   * the dynamic id route doesn't swallow it.
   */
  @Get('pending-returns')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async listPendingReturns() {
    const data = await this.orderManagement.listPendingReturns();
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-18: tick a DEVOLUCION row as "volvió" — the
   * courier physically returned the package. Idempotent;
   *   body { returned: false } reverts the stamp.
   */
  /**
   * Marcos 2026-06-21: cancelar pedido (no eliminar). Los operadores
   * no pueden borrar pedidos; en su lugar usan esta ruta que stampea
   * cancelledAt + cancelledById + cancellationReason. Razon
   * obligatoria (min 5 chars) — la valida el service. ADMIN +
   * LOGISTICA + VENTAS + ATENCION pueden cancelar.
   */
  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async cancelOrder(
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
    @Request() req: any,
  ) {
    try {
      const data = await this.orderManagement.cancelOrder(id, body?.reason ?? '', req.user?.id ?? null);
      if (!data) throw new NotFoundException('Pedido no encontrado');
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'order.cancel',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { orderId: id, orderNumber: data.orderNumber, reason: data.cancellationReason },
      });
      return { success: true, data };
    } catch (err: any) {
      if (err?.message?.includes('motivo de cancelacion requerido')) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  @Post(':id/mark-returned')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async markReturned(
    @Param('id') id: string,
    @Body() body: { returned?: boolean } = {},
    @Request() req: any,
  ) {
    const returned = body?.returned !== false;
    const data = await this.orderManagement.markReturned(id, returned, req.user?.id ?? null);
    if (!data) throw new NotFoundException('Pedido no encontrado');
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: returned ? 'order.return.mark' : 'order.return.unmark',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { orderId: id, orderNumber: data.orderNumber },
    });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-12: stamp an order as invoiced. Idempotent —
   * re-marking an already-invoiced order is a no-op.
   *   POST /admin/orders/:id/mark-invoiced     → marks invoiced now
   *   POST /admin/orders/:id/mark-invoiced
   *     body { invoiced: false }               → clears the stamp (undo)
   */
  @Post(':id/mark-invoiced')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION)
  async markInvoiced(
    @Param('id') id: string,
    @Body() body: { invoiced?: boolean } = {},
    @Request() req: any,
  ) {
    const invoiced = body?.invoiced !== false;
    const data = await this.orderManagement.markInvoiced(id, invoiced, req.user?.id ?? null);
    if (!data) throw new NotFoundException('Pedido no encontrado');
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: invoiced ? 'order.invoice.mark' : 'order.invoice.unmark',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { orderId: id, orderNumber: data.orderNumber },
    });
    return { success: true, data };
  }

  // List orders with filters.
  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async listOrders(
    @Query('status') status?: OrderStatus,
    @Query('contactId') contactId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('orderNumber') orderNumber?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.orderManagement.listOrders({
      status,
      contactId,
      conversationId,
      orderNumber,
      search,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    return { success: true, ...result };
  }

  /**
   * Marcos 2026-06-15: render the order as a printable PDF (same
   * letterhead as Presupuestos) including the shipping block. Declared
   * before @Get(':id') so the static segment isn't swallowed by the
   * dynamic route.
   */
  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS, UserRole.ATENCION, UserRole.ENCARGADO)
  async getOrderPdf(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.orderManagement.renderPdf(id);
    if (!buf) throw new NotFoundException('Pedido no encontrado');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="pedido-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  }

  /**
   * Marcos 2026-06-16: Zebra 10×15 cm shipping-label PDF.
   * One label per page, ready to print on the Zebra thermal.
   */
  @Get(':id/etiqueta')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS, UserRole.ATENCION, UserRole.ENCARGADO)
  async getOrderEtiqueta(
    @Param('id') id: string,
    @Query('bultos') bultosRaw: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const bultos = Number(bultosRaw) || 1;
    const buf = await this.orderManagement.renderEtiqueta(id, bultos);
    if (!buf) throw new NotFoundException('Pedido no encontrado');
    // Marcos 2026-06-20: registrar el print. Fire-and-forget — un
    // fallo acá nunca debe romper la descarga del PDF.
    void this.orderManagement.stampLabelPrinted(id, req.user?.userId ?? null).catch(() => {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-${id.slice(0, 8)}-${bultos}b.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  }

  /**
   * Marcos 2026-06-20: ¿esta etiqueta ya fue impresa antes? Lo
   * usa el frontend para decidir mostrar 'Imprimir etiqueta' vs
   * 'Re-imprimir etiqueta (ya se imprimió N veces)'. Lectura barata —
   * un solo campo del Order, no toca el PDF.
   */
  @Get(':id/etiqueta/status')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS, UserRole.ATENCION, UserRole.ENCARGADO)
  async getEtiquetaStatus(@Param('id') id: string) {
    const data = await this.orderManagement.getLabelPrintStatus(id);
    if (!data) throw new NotFoundException('Pedido no encontrado');
    return { success: true, data };
  }

  // Get order by ID
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS, UserRole.ENCARGADO)
  async getOrderById(@Param('id') id: string) {
    const data = await this.orderManagement.getOrderById(id);

    if (!data) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return { success: true, data };
  }

  // Create new order. Open to all operator roles because the in-chat
  // "Registrar pedido" flow lets ATENCION (Brenda) capture a confirmation
  // the moment the customer agrees in WhatsApp; VENTAS (Franco) does the
  // same for mayoristas. Body may include `conversationId` so the order
  // back-links to the chat where it was registered.
  @Post()
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async createOrder(@Body() body: any, @Request() req: any) {
    const data = await this.orderManagement.createOrder({
      ...body,
      // Marcos 2026-06-18: stamp the operator who loaded the order
      // so team-performance analytics can attribute manual sales.
      createdById: req.user?.id ?? null,
    });
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'order.create',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        orderId: data.id,
        orderNumber: data.orderNumber,
        contactId: data.contact.id,
        conversationId: data.conversationId ?? null,
        amount: data.amount,
        currency: data.currency,
      },
    });
    return { success: true, data };
  }

  // Update order
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async updateOrder(@Param('id') id: string, @Body() body: any) {
    const data = await this.orderManagement.updateOrder(id, body);

    if (!data) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return { success: true, data };
  }

  // Delete order
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteOrder(@Param('id') id: string, @Request() req: any) {
    const success = await this.orderManagement.deleteOrder(id);
    if (success) {
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'order.delete',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { orderId: id },
      });
    }
    return { success };
  }

  // Update order status (fulfillment lifecycle — logistics's domain)
  @Put(':id/status')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: OrderStatus },
    @Request() req: any,
  ) {
    const success = await this.orderManagement.updateOrderStatus(
      id,
      body.status,
    );
    if (success) {
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'order.status.update',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { orderId: id, newStatus: body.status },
      });
    }
    return { success };
  }

  // Update tracking info
  @Put(':id/tracking')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async updateTrackingInfo(
    @Param('id') id: string,
    @Body() body: { trackingNumber: string; carrier: string },
    @Request() req: any,
  ) {
    const success = await this.orderManagement.updateTrackingInfo(id, body);
    if (success) {
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'order.tracking.update',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { orderId: id, trackingNumber: body.trackingNumber, carrier: body.carrier },
      });
    }
    return { success };
  }
}
