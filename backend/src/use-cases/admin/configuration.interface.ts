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

/**
 * Bloque C — Marcos 2026-06-06: top of the daily logistics Excel
 * holds two pinned references the warehouse keeps an eye on. We
 * persist them once in Configuration so the daily file picks them up
 * automatically without anyone retyping them into the sheet.
 *
 *   linksFavoritos  — shortcut rows ({label, url}) to Drive resources
 *                     (ubicación de moldes, calculador, seguimiento de
 *                     tareas, mayoristas, errores, etc.)
 *   notasOperativas — free-form text block that prints under the links
 *                     for whatever the operator wants visible at the
 *                     top of the file on a given day.
 */
export interface LogisticaConfiguration {
  linksFavoritos: Array<{ label: string; url: string }>;
  notasOperativas: string;
  /** Marcos 2026-06-10: ordered list of the flex couriers that
   *  rotate through Servifibras's flex orders. Editable from the
   *  admin settings panel so Marcos can rename / replace them
   *  without a redeploy (services come and go). Default falls back
   *  to FLEX_COURIERS env when unset. */
  flexCouriers?: string[];
  /** Marcos 2026-06-10: per-family pickup cutoff hours (0-23 in
   *  America/Argentina/Buenos_Aires). After this hour, the
   *  carrier of that family has already picked up for the day —
   *  new orders arriving after the cutoff are for tomorrow.
   *  The daily panel renders a divider banner inside each section
   *  splitting "Para mañana" (above) from "Pueden salir hoy"
   *  (below). null disables the cutoff for that family. ML can
   *  change colecta cutoffs without warning, so this is editable
   *  from Settings → Logística. */
  cutoffHours?: {
    /** Applies to COLECTA_1 + COLECTA_2 (ML colecta retiros). */
    colecta?: number | null;
    /** Applies to FLEX_1 + FLEX_2. */
    flex?: number | null;
    /** Local fleet (MOTOS section + RETIRA_CASEROS keeps its own). */
    motos?: number | null;
    /** Interior cargo (MICROS section). null = no cutoff. */
    micros?: number | null;
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
   * Bloque C — Marcos 2026-06-06: Logística favorite Drive links +
   * notas operativas pinned at the top of the daily Excel.
   */
  getLogisticaConfiguration(): Promise<LogisticaConfiguration | null>;

  /**
   * Update system configuration
   */
  updateSystemConfiguration(config: Partial<SystemConfiguration>): Promise<boolean>;

  /**
   * Bloque C — Marcos 2026-06-06: update Logística favorite links / notas.
   */
  updateLogisticaConfiguration(config: Partial<LogisticaConfiguration>): Promise<boolean>;

  /**
   * Toggle configuration active status
   */
  toggleActive(id: string): Promise<boolean>;

  /**
   * Get all configurations by type
   */
  getConfigurationsByType(type: ConfigurationType): Promise<ConfigurationItem[]>;
}
