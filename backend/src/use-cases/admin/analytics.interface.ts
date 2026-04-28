/**
 * USE CASES LAYER - Analytics Interface
 * Defines analytics operations for admin dashboard
 */

import { Channel, ConversationStatus } from '@prisma/client';

export interface TimeRange {
  startDate: Date;
  endDate: Date;
}

export interface ConversationMetrics {
  total: number;
  active: number;
  closed: number;
  waiting: number;
  avgMessagesPerConversation: number;
  totalMessages: number;
}

export interface ConversationTrends {
  daily: Array<{
    date: string;
    total: number;
    active: number;
    closed: number;
  }>;
  byChannel: Record<Channel, number>;
  byStatus: Record<ConversationStatus, number>;
}

export interface ContactMetrics {
  total: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  byChannel: Record<Channel, number>;
  withActiveConversations: number;
}

export interface AIPerformanceMetrics {
  totalAIMessages: number;
  totalHumanMessages: number;
  aiResponseRate: number; // Percentage of messages handled by AI
  conversationsWithAI: number;
  conversationsFullyAutomated: number; // No human intervention
  averageAIMessagesPerConversation: number;
}

export interface ResponseTimeMetrics {
  avgFirstResponseTimeMinutes: number;
  avgOverallResponseTimeMinutes: number;
  conversationsWithFastResponse: number; // Response < 5 minutes
  conversationsWithSlowResponse: number; // Response > 1 hour
}

export interface ChannelPerformance {
  channel: Channel;
  totalConversations: number;
  activeConversations: number;
  avgMessagesPerConversation: number;
  totalMessages: number;
  aiResponseRate: number;
}

export interface DashboardSummary {
  conversationMetrics: ConversationMetrics;
  contactMetrics: ContactMetrics;
  aiPerformanceMetrics: AIPerformanceMetrics;
  topCategories: Array<{
    category: string;
    count: number;
  }>;
  recentActivity: {
    conversationsLast24h: number;
    messagesLast24h: number;
    newContactsLast24h: number;
  };
}

export interface IAnalyticsService {
  /**
   * Get dashboard summary with key metrics
   */
  getDashboardSummary(): Promise<DashboardSummary>;

  /**
   * Get conversation metrics for a time range
   */
  getConversationMetrics(timeRange?: TimeRange): Promise<ConversationMetrics>;

  /**
   * Get conversation trends over time
   */
  getConversationTrends(days?: number): Promise<ConversationTrends>;

  /**
   * Get contact metrics
   */
  getContactMetrics(): Promise<ContactMetrics>;

  /**
   * Get AI performance metrics
   */
  getAIPerformanceMetrics(timeRange?: TimeRange): Promise<AIPerformanceMetrics>;

  /**
   * Get response time metrics
   */
  getResponseTimeMetrics(timeRange?: TimeRange): Promise<ResponseTimeMetrics>;

  /**
   * Get channel performance comparison
   */
  getChannelPerformance(timeRange?: TimeRange): Promise<ChannelPerformance[]>;

  /**
   * Get time series data for charts
   */
  getTimeSeriesData(
    metric: 'conversations' | 'messages' | 'contacts',
    days: number,
  ): Promise<Array<{ date: string; value: number }>>;
}
