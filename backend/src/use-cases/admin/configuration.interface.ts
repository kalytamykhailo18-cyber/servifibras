/**
 * USE CASES LAYER - Configuration Management Interface
 * Defines configuration operations for admin dashboard
 */

import { ConfigurationType } from '@prisma/client';

export { ConfigurationType };

export interface ConfigurationItem {
  id: string;
  type: ConfigurationType;
  key: string;
  value: any;
  description?: string;
  isActive: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigurationListFilter {
  type?: ConfigurationType;
  key?: string;
  isActive?: boolean;
}

export interface CreateConfigurationInput {
  type: ConfigurationType;
  key: string;
  value: any;
  description?: string;
  isActive?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateConfigurationInput {
  value?: any;
  description?: string;
  isActive?: boolean;
  metadata?: Record<string, any>;
}

export interface ChannelConfiguration {
  enabled: boolean;
  apiKey?: string;
  apiSecret?: string;
  webhookUrl?: string;
  autoResponse: boolean;
  responseDelay?: number;
  businessHours?: {
    start: string;
    end: string;
  };
}

export interface AIConfiguration {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  autoResponseEnabled: boolean;
  confidenceThreshold: number;
  escalationKeywords: string[];
}

export interface PricingConfiguration {
  currency: string;
  taxRate: number;
  discountRules: Array<{
    name: string;
    percentage: number;
    conditions: Record<string, any>;
  }>;
  shippingRates: Record<string, number>;
}

export interface SystemConfiguration {
  maintenanceMode: boolean;
  maxConcurrentConversations: number;
  sessionTimeoutMinutes: number;
  backupEnabled: boolean;
  logLevel: string;
  features: {
    aiAutoResponse: boolean;
    knowledgeBase: boolean;
    analytics: boolean;
    multiChannel: boolean;
  };
}

export interface IConfigurationService {
  /**
   * List all configurations with filters
   */
  listConfigurations(filter: ConfigurationListFilter): Promise<ConfigurationItem[]>;

  /**
   * Get configuration by ID
   */
  getConfigurationById(id: string): Promise<ConfigurationItem | null>;

  /**
   * Get configuration by key
   */
  getConfigurationByKey(key: string): Promise<ConfigurationItem | null>;

  /**
   * Create new configuration
   */
  createConfiguration(input: CreateConfigurationInput): Promise<ConfigurationItem | null>;

  /**
   * Update existing configuration
   */
  updateConfiguration(
    id: string,
    input: UpdateConfigurationInput,
  ): Promise<ConfigurationItem | null>;

  /**
   * Delete configuration
   */
  deleteConfiguration(id: string): Promise<boolean>;

  /**
   * Get channel configuration
   */
  getChannelConfiguration(channel: string): Promise<ChannelConfiguration | null>;

  /**
   * Update channel configuration
   */
  updateChannelConfiguration(
    channel: string,
    config: Partial<ChannelConfiguration>,
  ): Promise<boolean>;

  /**
   * Get AI configuration
   */
  getAIConfiguration(): Promise<AIConfiguration | null>;

  /**
   * Update AI configuration
   */
  updateAIConfiguration(config: Partial<AIConfiguration>): Promise<boolean>;

  /**
   * Get pricing configuration
   */
  getPricingConfiguration(): Promise<PricingConfiguration | null>;

  /**
   * Update pricing configuration
   */
  updatePricingConfiguration(config: Partial<PricingConfiguration>): Promise<boolean>;

  /**
   * Get system configuration
   */
  getSystemConfiguration(): Promise<SystemConfiguration | null>;

  /**
   * Update system configuration
   */
  updateSystemConfiguration(config: Partial<SystemConfiguration>): Promise<boolean>;

  /**
   * Toggle configuration active status
   */
  toggleActive(id: string): Promise<boolean>;

  /**
   * Get all configurations by type
   */
  getConfigurationsByType(type: ConfigurationType): Promise<ConfigurationItem[]>;
}
