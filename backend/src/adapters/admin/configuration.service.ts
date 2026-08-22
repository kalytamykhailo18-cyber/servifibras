/**
 * ADAPTERS LAYER - Configuration Service
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../repositories/prisma.service';
import {
  IConfigurationService,
  ConfigurationItem,
  ConfigurationListFilter,
  CreateConfigurationInput,
  UpdateConfigurationInput,
  ChannelConfiguration,
  AIConfiguration,
  PricingConfiguration,
  SystemConfiguration,
  LogisticaConfiguration,
  ConfigurationType,
} from '../../use-cases/admin/configuration.interface';

@Injectable()
export class ConfigurationService implements IConfigurationService {
  private readonly logger = new Logger(ConfigurationService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
    this.logger.log('✅ Configuration service initialized');
  }

  async listConfigurations(filter: ConfigurationListFilter): Promise<ConfigurationItem[]> {
    try {
      const where: any = {};

      if (filter.type) {
        where.type = filter.type;
      }

      if (filter.key) {
        where.key = { contains: filter.key, mode: 'insensitive' };
      }

      if (filter.isActive !== undefined) {
        where.isActive = filter.isActive;
      }

      const configs = await this.prisma.configuration.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      });

      return configs.map((config) => ({
        id: config.id,
        type: config.type as any,
        key: config.key,
        value: config.value,
        description: config.description,
        isActive: config.isActive,
        metadata: (config.metadata as Record<string, any>) || {},
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }));
    } catch (error: any) {
      this.logger.error(`Error listing configurations: ${error.message}`);
      return [];
    }
  }

  async getConfigurationById(id: string): Promise<ConfigurationItem | null> {
    try {
      const config = await this.prisma.configuration.findUnique({
        where: { id },
      });

      if (!config) {
        return null;
      }

      return {
        id: config.id,
        type: config.type as any,
        key: config.key,
        value: config.value,
        description: config.description,
        isActive: config.isActive,
        metadata: (config.metadata as Record<string, any>) || {},
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error getting configuration: ${error.message}`);
      return null;
    }
  }

  async getConfigurationByKey(key: string): Promise<ConfigurationItem | null> {
    try {
      const config = await this.prisma.configuration.findUnique({
        where: { key },
      });

      if (!config) {
        return null;
      }

      return {
        id: config.id,
        type: config.type as any,
        key: config.key,
        value: config.value,
        description: config.description,
        isActive: config.isActive,
        metadata: (config.metadata as Record<string, any>) || {},
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error getting configuration by key: ${error.message}`);
      return null;
    }
  }

  async createConfiguration(
    input: CreateConfigurationInput,
  ): Promise<ConfigurationItem | null> {
    try {
      const config = await this.prisma.configuration.create({
        data: {
          type: input.type,
          key: input.key,
          value: input.value,
          description: input.description,
          isActive: input.isActive !== undefined ? input.isActive : true,
          metadata: input.metadata || {},
        },
      });

      this.logger.log(`✅ Configuration created: ${config.key} (${config.type})`);

      return {
        id: config.id,
        type: config.type as any,
        key: config.key,
        value: config.value,
        description: config.description,
        isActive: config.isActive,
        metadata: (config.metadata as Record<string, any>) || {},
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error creating configuration: ${error.message}`);
      return null;
    }
  }

  async updateConfiguration(
    id: string,
    input: UpdateConfigurationInput,
  ): Promise<ConfigurationItem | null> {
    try {
      const updateData: any = {};

      if (input.value !== undefined) updateData.value = input.value;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.metadata !== undefined) updateData.metadata = input.metadata;

      const config = await this.prisma.configuration.update({
        where: { id },
        data: updateData,
      });

      this.logger.log(`✅ Configuration updated: ${id}`);

      return {
        id: config.id,
        type: config.type as any,
        key: config.key,
        value: config.value,
        description: config.description,
        isActive: config.isActive,
        metadata: (config.metadata as Record<string, any>) || {},
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error updating configuration: ${error.message}`);
      return null;
    }
  }

  async deleteConfiguration(id: string): Promise<boolean> {
    try {
      await this.prisma.configuration.delete({
        where: { id },
      });

      this.logger.log(`✅ Configuration deleted: ${id}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error deleting configuration: ${error.message}`);
      return false;
    }
  }

  async getChannelConfiguration(channel: string): Promise<ChannelConfiguration | null> {
    try {
      const config = await this.getConfigurationByKey(`channel_${channel.toLowerCase()}`);

      if (!config) {
        return null;
      }

      return config.value as ChannelConfiguration;
    } catch (error: any) {
      this.logger.error(`Error getting channel configuration: ${error.message}`);
      return null;
    }
  }

  async updateChannelConfiguration(
    channel: string,
    config: Partial<ChannelConfiguration>,
  ): Promise<boolean> {
    try {
      const key = `channel_${channel.toLowerCase()}`;
      const existing = await this.getConfigurationByKey(key);

      if (existing) {
        const newValue = { ...existing.value, ...config };
        await this.prisma.configuration.update({
          where: { key },
          data: { value: newValue },
        });
      } else {
        await this.createConfiguration({
          type: ConfigurationType.CHANNEL,
          key,
          value: config,
          description: `Configuration for ${channel} channel`,
        });
      }

      this.logger.log(`✅ Channel configuration updated: ${channel}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating channel configuration: ${error.message}`);
      return false;
    }
  }

  async getAIConfiguration(): Promise<AIConfiguration | null> {
    try {
      const config = await this.getConfigurationByKey('ai_settings');

      if (!config) {
        return null;
      }

      return config.value as AIConfiguration;
    } catch (error: any) {
      this.logger.error(`Error getting AI configuration: ${error.message}`);
      return null;
    }
  }

  async updateAIConfiguration(config: Partial<AIConfiguration>): Promise<boolean> {
    try {
      const existing = await this.getConfigurationByKey('ai_settings');

      if (existing) {
        const newValue = { ...existing.value, ...config };
        await this.prisma.configuration.update({
          where: { key: 'ai_settings' },
          data: { value: newValue },
        });
      } else {
        await this.createConfiguration({
          type: ConfigurationType.AI,
          key: 'ai_settings',
          value: config,
          description: 'AI and automation settings',
        });
      }

      this.logger.log('✅ AI configuration updated');
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating AI configuration: ${error.message}`);
      return false;
    }
  }

  async getPricingConfiguration(): Promise<PricingConfiguration | null> {
    try {
      const config = await this.getConfigurationByKey('pricing_rules');

      if (!config) {
        return null;
      }

      return config.value as PricingConfiguration;
    } catch (error: any) {
      this.logger.error(`Error getting pricing configuration: ${error.message}`);
      return null;
    }
  }

  async updatePricingConfiguration(config: Partial<PricingConfiguration>): Promise<boolean> {
    try {
      const existing = await this.getConfigurationByKey('pricing_rules');

      if (existing) {
        const newValue = { ...existing.value, ...config };
        await this.prisma.configuration.update({
          where: { key: 'pricing_rules' },
          data: { value: newValue },
        });
      } else {
        await this.createConfiguration({
          type: ConfigurationType.PRICING,
          key: 'pricing_rules',
          value: config,
          description: 'Pricing and discount rules',
        });
      }

      this.logger.log('✅ Pricing configuration updated');
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating pricing configuration: ${error.message}`);
      return false;
    }
  }

  async getSystemConfiguration(): Promise<SystemConfiguration | null> {
    try {
      const config = await this.getConfigurationByKey('system_settings');

      if (!config) {
        return null;
      }

      return config.value as SystemConfiguration;
    } catch (error: any) {
      this.logger.error(`Error getting system configuration: ${error.message}`);
      return null;
    }
  }

  async updateSystemConfiguration(config: Partial<SystemConfiguration>): Promise<boolean> {
    try {
      const existing = await this.getConfigurationByKey('system_settings');

      if (existing) {
        const newValue = { ...existing.value, ...config };
        await this.prisma.configuration.update({
          where: { key: 'system_settings' },
          data: { value: newValue },
        });
      } else {
        await this.createConfiguration({
          type: ConfigurationType.SYSTEM,
          key: 'system_settings',
          value: config,
          description: 'System-wide settings',
        });
      }

      this.logger.log('✅ System configuration updated');
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating system configuration: ${error.message}`);
      return false;
    }
  }

  /**
   * Logística configuration — Marcos 2026-06-06 (Bloque C). The daily
   * Excel auto-gen pulls its top "fixed header" from this row: a list
   * of Drive shortcut links the warehouse keeps pinned (ubicación de
   * moldes, calculadora, seguimiento de tareas, mayoristas, errores)
   * plus a free-form "notas operativas" block. Both edit from the
   * admin Settings → Logística tab.
   *
   * Shape:
   *   {
   *     linksFavoritos: [{ label: string, url: string }, ...]
   *     notasOperativas: string
   *   }
   */
  async getLogisticaConfiguration(): Promise<LogisticaConfiguration | null> {
    try {
      const config = await this.getConfigurationByKey('logistica_settings');
      if (!config) return null;
      return config.value as LogisticaConfiguration;
    } catch (error: any) {
      this.logger.error(`Error getting logistica configuration: ${error.message}`);
      return null;
    }
  }

  async updateLogisticaConfiguration(config: Partial<LogisticaConfiguration>): Promise<boolean> {
    try {
      const existing = await this.getConfigurationByKey('logistica_settings');
      if (existing) {
        const newValue = { ...(existing.value as any), ...config };
        await this.prisma.configuration.update({
          where: { key: 'logistica_settings' },
          data: { value: newValue },
        });
      } else {
        await this.createConfiguration({
          type: ConfigurationType.SYSTEM,
          key: 'logistica_settings',
          value: config,
          description: 'Logistica — favorite Drive links + operative notes shown on the daily Excel header',
        });
      }
      this.logger.log('✅ Logistica configuration updated');
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating logistica configuration: ${error.message}`);
      return false;
    }
  }

  async toggleActive(id: string): Promise<boolean> {
    try {
      const config = await this.prisma.configuration.findUnique({
        where: { id },
      });

      if (!config) {
        return false;
      }

      await this.prisma.configuration.update({
        where: { id },
        data: { isActive: !config.isActive },
      });

      this.logger.log(
        `✅ Configuration ${id} toggled to ${!config.isActive ? 'active' : 'inactive'}`,
      );
      return true;
    } catch (error: any) {
      this.logger.error(`Error toggling active status: ${error.message}`);
      return false;
    }
  }

  async getConfigurationsByType(type: ConfigurationType): Promise<ConfigurationItem[]> {
    try {
      const configs = await this.prisma.configuration.findMany({
        where: { type },
        orderBy: { updatedAt: 'desc' },
      });

      return configs.map((config) => ({
        id: config.id,
        type: config.type as any,
        key: config.key,
        value: config.value,
        description: config.description,
        isActive: config.isActive,
        metadata: (config.metadata as Record<string, any>) || {},
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }));
    } catch (error: any) {
      this.logger.error(`Error getting configurations by type: ${error.message}`);
      return [];
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
