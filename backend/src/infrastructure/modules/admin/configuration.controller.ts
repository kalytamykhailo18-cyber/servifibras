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
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ConfigurationService } from '../../../adapters/admin/configuration.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { ConfigurationType } from '../../../use-cases/admin/configuration.interface';

@Controller('admin/configuration')
@UseGuards(AuthGuard, RolesGuard)
export class ConfigurationController {
  private readonly logger = new Logger(ConfigurationController.name);

  constructor(private readonly configurationService: ConfigurationService) {}

  /**
   * List all configurations with filters
   * GET /admin/configuration
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
  ) {
    const success = await this.configurationService.updateChannelConfiguration(
      channel,
      body,
    );

    if (success) {
      this.logger.log(`Channel configuration updated: ${channel} by admin`);
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
   * Get configuration by key
   * GET /admin/configuration/key/:key
   */
  @Get('key/:key')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
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
}
