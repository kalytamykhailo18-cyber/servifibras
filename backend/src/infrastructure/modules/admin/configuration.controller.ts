/**
 * INFRASTRUCTURE LAYER - Admin Configuration Controller
 * Manages system configuration settings
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ConfigurationService } from '../../../adapters/admin/configuration.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { PrismaClient } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { ConfigurationType } from '../../../use-cases/admin/configuration.interface';

@Controller('admin/configuration')
@UseGuards(AuthGuard, RolesGuard)
export class ConfigurationController {
  private readonly logger = new Logger(ConfigurationController.name);

  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly audit: AuditLogService,
    private readonly claude: ClaudeService,
  ) {}

  /**
   * GET /admin/configuration/lucas-prompt — fetch the currently-loaded
   * Lucas system prompt + provenance (db override or on-disk default)
   * so the admin Settings page can show "running from DB, last edit X"
   * above the editor. Read-only; no audit row.
   */
  @Get('lucas-prompt')
  @Roles(UserRole.ADMIN)
  async getLucasPrompt() {
    return {
      success: true,
      data: this.claude.getLucasPromptSnapshot(),
    };
  }

  /**
   * PUT /admin/configuration/lucas-prompt — persist a new Lucas system
   * prompt to the Configuration table and hot-reload ClaudeService so
   * the next customer reply uses it. No server restart, no AnyDesk.
   * Strict admin-only (Brenda/Franco/Aldo would only see this surface
   * if they read-only browsed, but the gate is enforced server-side).
   */
  @Put('lucas-prompt')
  @Roles(UserRole.ADMIN)
  async updateLucasPrompt(
    @Req() req: ExpressRequest,
    @Body() body: { content?: string },
  ) {
    const content = typeof body?.content === 'string' ? body.content : '';
    const userId = (req as any)?.user?.id ?? null;
    let snapshot;
    try {
      snapshot = await this.claude.saveLucasPrompt(content, { userId });
    } catch (err: any) {
      this.logger.warn(`Lucas prompt update rejected: ${err?.message ?? err}`);
      return { success: false, error: err?.message ?? 'invalid prompt' };
    }
    await this.audit.logFromRequest(req as any, {
      action: 'config.lucas_prompt.updated',
      userId,
      metadata: { length: snapshot.length, source: snapshot.source },
    });
    this.logger.log(`Lucas prompt updated (length=${snapshot.length})`);
    return {
      success: true,
      data: { ...this.claude.getLucasPromptSnapshot() },
    };
  }

  /**
   * POST /admin/configuration/lucas-prompt/reset — drop the DB override
   * and fall back to the canonical on-disk default. Lets Marcos undo
   * a bad edit without having to copy-paste the original file content.
   */
  @Post('lucas-prompt/reset')
  @Roles(UserRole.ADMIN)
  async resetLucasPrompt(@Req() req: ExpressRequest) {
    const userId = (req as any)?.user?.id ?? null;
    await this.claude.resetLucasPrompt();
    await this.audit.logFromRequest(req as any, {
      action: 'config.lucas_prompt.reset',
      userId,
    });
    return {
      success: true,
      data: this.claude.getLucasPromptSnapshot(),
    };
  }

  /**
   * List all configurations with filters
   * GET /admin/configuration
   */
  @Get()
  @Roles(UserRole.ADMIN)
  async listConfigurations(
    @Query('type') type?: ConfigurationType,
    @Query('key') key?: string,
    @Query('isActive') isActive?: string,
  ) {
    const configs = await this.configurationService.listConfigurations({
      type,
      key,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });

    return {
      success: true,
      data: configs,
      total: configs.length,
    };
  }

  /**
   * Get configurations by type
   * GET /admin/configuration/type/:type
   */
  @Get('type/:type')
  @Roles(UserRole.ADMIN)
  async getConfigurationsByType(@Param('type') type: ConfigurationType) {
    const configs = await this.configurationService.getConfigurationsByType(type);

    return {
      success: true,
      data: configs,
    };
  }

  /**
   * Get channel configuration
   * GET /admin/configuration/channel/:channel
   */
  @Get('channel/:channel')
  @Roles(UserRole.ADMIN)
  async getChannelConfiguration(@Param('channel') channel: string) {
    const config = await this.configurationService.getChannelConfiguration(channel);

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Update channel configuration
   * PUT /admin/configuration/channel/:channel
   */
  @Put('channel/:channel')
  @Roles(UserRole.ADMIN)
  async updateChannelConfiguration(
    @Param('channel') channel: string,
    @Body() body: any,
    @Req() req: ExpressRequest & { user?: { id: string; email: string } },
  ) {
    const success = await this.configurationService.updateChannelConfiguration(
      channel,
      body,
    );

    if (success) {
      this.logger.log(`Channel configuration updated: ${channel} by admin`);
      // Audit: capture which channel and the new enabled-state, since
      // toggling the channel off is a high-impact security-relevant action.
      await this.audit.log({
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ?? null,
        action: 'config.channel.updated',
        ip: ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip) ?? null,
        userAgent: (req.headers['user-agent'] as string) ?? null,
        metadata: { channel, enabled: body?.enabled, fieldsChanged: Object.keys(body ?? {}) },
      });
      return { success: true, message: 'Channel configuration updated' };
    } else {
      return { success: false, error: 'Failed to update channel configuration' };
    }
  }

  /**
   * Get AI configuration
   * GET /admin/configuration/ai
   */
  @Get('ai/settings')
  @Roles(UserRole.ADMIN)
  async getAIConfiguration() {
    const config = await this.configurationService.getAIConfiguration();

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Update AI configuration
   * PUT /admin/configuration/ai
   */
  @Put('ai/settings')
  @Roles(UserRole.ADMIN)
  async updateAIConfiguration(@Body() body: any) {
    const success = await this.configurationService.updateAIConfiguration(body);

    if (success) {
      this.logger.log('AI configuration updated by admin');
      return { success: true, message: 'AI configuration updated' };
    } else {
      return { success: false, error: 'Failed to update AI configuration' };
    }
  }

  /**
   * Get pricing configuration
   * GET /admin/configuration/pricing
   */
  @Get('pricing/settings')
  @Roles(UserRole.ADMIN)
  async getPricingConfiguration() {
    const config = await this.configurationService.getPricingConfiguration();

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Update pricing configuration
   * PUT /admin/configuration/pricing
   */
  @Put('pricing/settings')
  @Roles(UserRole.ADMIN)
  async updatePricingConfiguration(@Body() body: any) {
    const success = await this.configurationService.updatePricingConfiguration(body);

    if (success) {
      this.logger.log('Pricing configuration updated by admin');
      return { success: true, message: 'Pricing configuration updated' };
    } else {
      return { success: false, error: 'Failed to update pricing configuration' };
    }
  }

  /**
   * Get system configuration
   * GET /admin/configuration/system
   */
  @Get('system/settings')
  @Roles(UserRole.ADMIN)
  async getSystemConfiguration() {
    const config = await this.configurationService.getSystemConfiguration();

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Update system configuration
   * PUT /admin/configuration/system
   */
  @Put('system/settings')
  @Roles(UserRole.ADMIN)
  async updateSystemConfiguration(@Body() body: any) {
    const success = await this.configurationService.updateSystemConfiguration(body);

    if (success) {
      this.logger.log('System configuration updated by admin');
      return { success: true, message: 'System configuration updated' };
    } else {
      return { success: false, error: 'Failed to update system configuration' };
    }
  }

  /**
   * Bloque C — Marcos 2026-06-06: Logística favorite Drive links +
   * notas operativas (header data for the daily Excel auto-gen).
   * GET returns the persisted shape; PUT upserts.
   */
  @Get('logistica/settings')
  @Roles(UserRole.ADMIN)
  async getLogisticaConfiguration() {
    const config = await this.configurationService.getLogisticaConfiguration();
    return {
      success: true,
      data: config ?? { linksFavoritos: [], notasOperativas: '' },
    };
  }

  @Put('logistica/settings')
  @Roles(UserRole.ADMIN)
  async updateLogisticaConfiguration(@Body() body: any) {
    const success = await this.configurationService.updateLogisticaConfiguration(body);
    if (success) {
      this.logger.log('Logistica configuration updated by admin');
      return { success: true, message: 'Logistica configuration updated' };
    }
    return { success: false, error: 'Failed to update logistica configuration' };
  }

  /**
   * Get configuration by key
   * GET /admin/configuration/key/:key
   */
  @Get('key/:key')
  @Roles(UserRole.ADMIN)
  async getConfigurationByKey(@Param('key') key: string) {
    const config = await this.configurationService.getConfigurationByKey(key);

    if (!config) {
      return {
        success: false,
        error: 'Configuration not found',
      };
    }

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Get configuration by ID
   * GET /admin/configuration/:id
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getConfiguration(@Param('id') id: string) {
    const config = await this.configurationService.getConfigurationById(id);

    if (!config) {
      return {
        success: false,
        error: 'Configuration not found',
      };
    }

    return {
      success: true,
      data: config,
    };
  }

  /**
   * Create new configuration
   * POST /admin/configuration
   */
  @Post()
  @Roles(UserRole.ADMIN)
  async createConfiguration(
    @Body()
    body: {
      type: ConfigurationType;
      key: string;
      value: any;
      description?: string;
      isActive?: boolean;
      metadata?: Record<string, any>;
    },
  ) {
    if (!body.type || !body.key || body.value === undefined) {
      return {
        success: false,
        error: 'Type, key, and value are required',
      };
    }

    const config = await this.configurationService.createConfiguration(body);

    if (config) {
      this.logger.log(`Configuration created: ${config.key} by admin`);
      return { success: true, data: config };
    } else {
      return { success: false, error: 'Failed to create configuration' };
    }
  }

  /**
   * Update existing configuration
   * PUT /admin/configuration/:id
   */
  @Put(':id')
  @Roles(UserRole.ADMIN)
  async updateConfiguration(
    @Param('id') id: string,
    @Body()
    body: {
      value?: any;
      description?: string;
      isActive?: boolean;
      metadata?: Record<string, any>;
    },
  ) {
    const config = await this.configurationService.updateConfiguration(id, body);

    if (config) {
      this.logger.log(`Configuration updated: ${id} by admin`);
      return { success: true, data: config };
    } else {
      return { success: false, error: 'Failed to update configuration' };
    }
  }

  /**
   * Toggle active status
   * POST /admin/configuration/:id/toggle
   */
  @Post(':id/toggle')
  @Roles(UserRole.ADMIN)
  async toggleActive(@Param('id') id: string) {
    const success = await this.configurationService.toggleActive(id);

    if (success) {
      this.logger.log(`Configuration toggled: ${id} by admin`);
      return { success: true, message: 'Active status toggled' };
    } else {
      return { success: false, error: 'Failed to toggle active status' };
    }
  }

  /**
   * Delete configuration
   * DELETE /admin/configuration/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteConfiguration(@Param('id') id: string) {
    const success = await this.configurationService.deleteConfiguration(id);

    if (success) {
      this.logger.log(`Configuration deleted: ${id} by admin`);
      return { success: true, message: 'Configuration deleted' };
    } else {
      return {
        success: false,
        error: 'Failed to delete configuration',
      };
    }
  }

  // ============================================================
  // AGENT CORRECTIONS — operator feedback loop
  // ============================================================
  //
  // The "reactive prompt-rule patch" loop Marcos was caught in (every bad
  // reply he flagged triggered me to write another rule) doesn't scale and
  // the model doesn't always honor abstract rules. The structural fix is
  // few-shot: each correction Marcos submits becomes a row in
  // ConversationExample, which ConversationStyleService loads on every
  // reply as part of the system prompt. The next reply learns from the
  // correction WITHOUT a code change or restart.
  //
  // Lifecycle:
  //   POST   /admin/configuration/ai/corrections   → create
  //   GET    /admin/configuration/ai/corrections   → list active
  //   DELETE /admin/configuration/ai/corrections/:id → remove a wrong one
  //
  // Marcos's input shape:
  //   {
  //     customerContext: "Cliente preguntó por mesa de río 60x30x10 cm",
  //     badReply:        "¿qué espesor querés aplicar?",
  //     goodReply:       "Para 60x30x10 son 18 L. Te recomiendo kit de 6 L
  //                       de altos espesores: <link>. ¿Tablas o solo resina?",
  //     scenario?:       "mesa-rio-volumen"   // optional bucket
  //   }
  //
  // We materialise this as a 3-turn ConversationExample: customer → bad
  // reply implicit (not stored) → ideal reply. Actually we store TWO
  // turns: customer prompt + ideal reply. Few-shots train by example,
  // not by negative; surfacing the bad version in the prompt would just
  // give the model another pattern to copy.

  private readonly correctionsPrisma = new PrismaClient();

  @Post('ai/corrections')
  @Roles(UserRole.ADMIN)
  async createCorrection(
    @Body() body: { customerContext?: string; badReply?: string; goodReply: string; scenario?: string; title?: string },
    @Req() req: ExpressRequest,
  ) {
    const goodReply = (body?.goodReply ?? '').trim();
    const customerContext = (body?.customerContext ?? '').trim();
    if (!goodReply || !customerContext) {
      return { success: false, error: 'customerContext y goodReply son obligatorios' };
    }
    const scenario = (body?.scenario ?? 'correccion').trim() || 'correccion';
    const title = (body?.title ?? '').trim() || `Corrección manual ${new Date().toISOString().slice(0, 10)}`;

    const turns = [
      { role: 'user' as const,      content: customerContext },
      { role: 'assistant' as const, content: goodReply },
    ];

    const row = await this.correctionsPrisma.conversationExample.create({
      data: { scenario, title, priority: 250, active: true, turns },
    });

    // Audit so we can trace which admin added which correction.
    const adminUser = (req as any).user;
    await this.audit.log({
      userId:    adminUser?.id ?? null,
      userEmail: adminUser?.email ?? 'unknown',
      action:    'ai.correction.added',
      metadata:  { conversationExampleId: row.id, scenario, title, badReplyProvided: !!body?.badReply },
    }).catch((e: any) => this.logger.warn(`audit failed: ${e?.message}`));

    this.logger.log(`AI correction added by ${adminUser?.email}: scenario=${scenario} id=${row.id}`);
    return { success: true, data: { id: row.id, scenario, title } };
  }

  @Get('ai/corrections')
  @Roles(UserRole.ADMIN)
  async listCorrections() {
    const rows = await this.correctionsPrisma.conversationExample.findMany({
      where: { active: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, scenario: true, title: true, priority: true, turns: true, createdAt: true },
    });
    return { success: true, data: rows };
  }

  @Delete('ai/corrections/:id')
  @Roles(UserRole.ADMIN)
  async deleteCorrection(@Param('id') id: string, @Req() req: ExpressRequest) {
    const adminUser = (req as any).user;
    const row = await this.correctionsPrisma.conversationExample.findUnique({ where: { id } });
    if (!row) return { success: false, error: 'No existe esa corrección' };
    await this.correctionsPrisma.conversationExample.update({ where: { id }, data: { active: false } });
    await this.audit.log({
      userId:    adminUser?.id ?? null,
      userEmail: adminUser?.email ?? 'unknown',
      action:    'ai.correction.removed',
      metadata:  { conversationExampleId: id, scenario: row.scenario, title: row.title },
    }).catch((e: any) => this.logger.warn(`audit failed: ${e?.message}`));
    this.logger.log(`AI correction soft-deleted by ${adminUser?.email}: id=${id}`);
    return { success: true };
  }
}
