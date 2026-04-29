// ============================================================================
// SERVIFIBRAS API ENDPOINTS
// ============================================================================
// All 74 backend API endpoints organized by feature
// Type-safe request/response handling
// ============================================================================

import { apiClient } from "./client";
import type {
  // Auth
  LoginRequest,
  LoginResponse,
  AuthUser,

  // Conversations
  GetConversationsParams,
  GetConversationsResponse,
  ConversationWithRelations,
  SendMessageRequest,
  AssignConversationRequest,
  UpdateConversationStatusRequest,
  Message,

  // Contacts
  GetContactsParams,
  GetContactsResponse,
  Contact,
  ContactWithRelations,
  CreateContactRequest,
  UpdateContactRequest,
  MergeContactsRequest,

  // Knowledge Base
  GetKnowledgeParams,
  GetKnowledgeResponse,
  KnowledgeBase,
  CreateKnowledgeRequest,
  UpdateKnowledgeRequest,

  // Analytics
  DashboardSummary,
  ConversationMetrics,
  ContactMetrics,
  AIPerformanceMetrics,

  // Users
  User,

  // Leads
  GetLeadsParams,
  GetLeadsResponse,
  LeadWithRelations,
  CreateLeadRequest,
  UpdateLeadRequest,
  UpdateLeadStatusRequest,
  LeadPipelineStats,

  // Orders
  GetOrdersParams,
  GetOrdersResponse,
  OrderWithRelations,
  CreateOrderRequest,
  UpdateOrderRequest,
  UpdateOrderStatusRequest,
  OrderFulfillmentStats,

  // Configuration
  GetConfigurationsParams,
  Configuration,
  CreateConfigurationRequest,
  UpdateConfigurationRequest,
} from "@/types";

// ============================================================================
// AUTHENTICATION (2 endpoints)
// ============================================================================

export const authApi = {
  /**
   * POST /auth/login
   * Login with email and password
   */
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>("/auth/login", data);
    return response.data;
  },

  /**
   * GET /auth/me
   * Get current authenticated user
   */
  getCurrentUser: async (): Promise<AuthUser> => {
    const response = await apiClient.get<AuthUser>("/auth/me");
    return response.data;
  },
};

// ============================================================================
// USERS (1 endpoint)
// ============================================================================

export const usersApi = {
  /**
   * GET /admin/users
   * Get all users
   */
  list: async (): Promise<User[]> => {
    const response = await apiClient.get<User[]>("/admin/users");
    return response.data;
  },
};

// ============================================================================
// CONVERSATIONS (7 endpoints)
// ============================================================================

export const conversationsApi = {
  /**
   * GET /admin/conversations
   * Get paginated list of conversations with filters
   */
  getAll: async (params?: GetConversationsParams): Promise<GetConversationsResponse> => {

    // Transform page-based params to offset-based for backend
    const limit = params?.limit || 20;
    const page = params?.page || 1;

    const backendParams: any = {
      limit,
      offset: (page - 1) * limit,
    };

    if (params) {
      if (params.status) backendParams.status = params.status;
      if (params.channel) backendParams.channel = params.channel;
      if (params.assignedTo) backendParams.assignedTo = params.assignedTo;
      if (params.search) backendParams.search = params.search;
    }


    const response = await apiClient.get<{
      success: boolean;
      data: ConversationWithRelations[];
      total: number;
      limit: number;
      offset: number;
    }>("/admin/conversations", { params: backendParams });


    // Transform backend response to frontend format
    const responseLimit = response.data.limit || 20;
    const responseOffset = response.data.offset || 0;
    const responsePage = Math.floor(responseOffset / responseLimit) + 1;
    const responseTotalPages = Math.ceil(response.data.total / responseLimit);

    const result = {
      conversations: response.data.data,
      total: response.data.total,
      page: responsePage,
      limit: responseLimit,
      totalPages: responseTotalPages,
    };


    return result;
  },

  /**
   * GET /admin/conversations/:id
   * Get single conversation with messages and relations
   */
  getById: async (id: string): Promise<ConversationWithRelations> => {
    const response = await apiClient.get<{
      success: boolean;
      data: ConversationWithRelations;
    }>(`/admin/conversations/${id}`);
    return response.data.data;
  },

  /**
   * POST /admin/conversations/:id/assign
   * Assign conversation to a user (Brenda, Franco, Aldo, Admin)
   */
  assign: async (id: string, data: AssignConversationRequest): Promise<ConversationWithRelations> => {
    const response = await apiClient.post<ConversationWithRelations>(
      `/admin/conversations/${id}/assign`,
      data
    );
    return response.data;
  },

  /**
   * POST /admin/conversations/:id/takeover
   * Take over conversation from AI (manual intervention)
   */
  takeover: async (id: string): Promise<ConversationWithRelations> => {
    const response = await apiClient.post<ConversationWithRelations>(
      `/admin/conversations/${id}/takeover`
    );
    return response.data;
  },

  /**
   * PUT /admin/conversations/:id/status
   * Update conversation status (ACTIVE, CLOSED, WAITING)
   */
  updateStatus: async (
    id: string,
    data: UpdateConversationStatusRequest
  ): Promise<ConversationWithRelations> => {
    const response = await apiClient.put<ConversationWithRelations>(
      `/admin/conversations/${id}/status`,
      data
    );
    return response.data;
  },

  /**
   * POST /admin/conversations/:id/message
   * Send manual message in conversation (from human agent)
   */
  sendMessage: async (id: string, data: SendMessageRequest): Promise<Message> => {
    const response = await apiClient.post<Message>(`/admin/conversations/${id}/message`, data);
    return response.data;
  },

  /**
   * GET /admin/conversations/stats
   * Get conversation statistics and metrics
   */
  getStats: async (): Promise<ConversationMetrics> => {
    const response = await apiClient.get<ConversationMetrics>("/admin/conversations/stats");
    return response.data;
  },
};

// ============================================================================
// CONTACTS (6 endpoints)
// ============================================================================

export const contactsApi = {
  /**
   * GET /admin/contacts
   * Get paginated list of contacts with filters
   */
  getAll: async (params?: GetContactsParams): Promise<GetContactsResponse> => {

    // Transform page-based params to offset-based for backend
    const limit = params?.limit || 20;
    const page = params?.page || 1;

    const backendParams: any = {
      limit,
      offset: (page - 1) * limit,
    };

    if (params) {
      if (params.type) backendParams.type = params.type;
      if (params.channel) backendParams.channel = params.channel;
      if (params.search) backendParams.search = params.search;
    }

    const response = await apiClient.get<{
      success: boolean;
      data: Contact[];
      total: number;
      limit: number;
      offset: number;
    }>("/admin/contacts", { params: backendParams });


    // Transform backend response to frontend format
    const responseLimit = response.data.limit || 20;
    const responseOffset = response.data.offset || 0;
    const responsePage = Math.floor(responseOffset / responseLimit) + 1;
    const responseTotalPages = Math.ceil(response.data.total / responseLimit);

    const result = {
      contacts: response.data.data,
      total: response.data.total,
      page: responsePage,
      limit: responseLimit,
      totalPages: responseTotalPages,
    };

    return result;
  },

  /**
   * Alias for getAll() - for backward compatibility
   */
  list: async (params?: GetContactsParams): Promise<GetContactsResponse> => {
    return contactsApi.getAll(params);
  },

  /**
   * GET /admin/contacts/:id
   * Get single contact with all relations (conversations, leads, orders)
   */
  getById: async (id: string): Promise<ContactWithRelations> => {
    const response = await apiClient.get<ContactWithRelations>(`/admin/contacts/${id}`);
    return response.data;
  },

  /**
   * POST /admin/contacts
   * Create new contact
   */
  create: async (data: CreateContactRequest): Promise<Contact> => {
    const response = await apiClient.post<Contact>("/admin/contacts", data);
    return response.data;
  },

  /**
   * PUT /admin/contacts/:id
   * Update contact information
   */
  update: async (id: string, data: UpdateContactRequest): Promise<Contact> => {
    const response = await apiClient.put<Contact>(`/admin/contacts/${id}`, data);
    return response.data;
  },

  /**
   * DELETE /admin/contacts/:id
   * Delete contact (soft delete, keeps historical data)
   */
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/contacts/${id}`);
  },

  /**
   * POST /admin/contacts/merge
   * Merge multiple contacts into one (deduplication)
   */
  merge: async (data: MergeContactsRequest): Promise<Contact> => {
    const response = await apiClient.post<Contact>("/admin/contacts/merge", data);
    return response.data;
  },
};

// ============================================================================
// KNOWLEDGE BASE (5 endpoints)
// ============================================================================

export const knowledgeApi = {
  /**
   * GET /admin/knowledge
   * Get paginated knowledge base items with filters
   */
  getAll: async (params?: GetKnowledgeParams): Promise<GetKnowledgeResponse> => {

    // Transform page-based params to offset-based for backend
    const limit = params?.limit || 20;
    const page = params?.page || 1;

    const backendParams: any = {
      limit,
      offset: (page - 1) * limit,
    };

    if (params) {
      if (params.category) backendParams.category = params.category;
      if (params.subcategory) backendParams.subcategory = params.subcategory;
      if (params.active !== undefined) backendParams.active = params.active;
      if (params.search) backendParams.search = params.search;
    }

    const response = await apiClient.get<{
      success: boolean;
      data: KnowledgeBase[];
      total: number;
      limit: number;
      offset: number;
    }>("/admin/knowledge", { params: backendParams });


    // Transform backend response to frontend format
    const responseLimit = response.data.limit || 20;
    const responseOffset = response.data.offset || 0;
    const responsePage = Math.floor(responseOffset / responseLimit) + 1;
    const responseTotalPages = Math.ceil(response.data.total / responseLimit);

    const result = {
      items: response.data.data,
      total: response.data.total,
      page: responsePage,
      limit: responseLimit,
      totalPages: responseTotalPages,
    };

    return result;
  },

  /**
   * GET /admin/knowledge/:id
   * Get single knowledge base item
   */
  getById: async (id: string): Promise<KnowledgeBase> => {
    const response = await apiClient.get<KnowledgeBase>(`/admin/knowledge/${id}`);
    return response.data;
  },

  /**
   * POST /admin/knowledge
   * Create new knowledge base item
   */
  create: async (data: CreateKnowledgeRequest): Promise<KnowledgeBase> => {
    const response = await apiClient.post<KnowledgeBase>("/admin/knowledge", data);
    return response.data;
  },

  /**
   * PUT /admin/knowledge/:id
   * Update knowledge base item
   */
  update: async (id: string, data: UpdateKnowledgeRequest): Promise<KnowledgeBase> => {
    const response = await apiClient.put<KnowledgeBase>(`/admin/knowledge/${id}`, data);
    return response.data;
  },

  /**
   * DELETE /admin/knowledge/:id
   * Delete knowledge base item
   */
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/knowledge/${id}`);
  },
};

// ============================================================================
// ANALYTICS (4 endpoints)
// ============================================================================

export const analyticsApi = {
  /**
   * GET /admin/analytics/dashboard
   * Get complete dashboard summary with all metrics
   */
  getDashboard: async (): Promise<DashboardSummary> => {
    const response = await apiClient.get<DashboardSummary>("/admin/analytics/dashboard");
    return response.data;
  },

  /**
   * GET /admin/analytics/dashboard (alias)
   * Get complete dashboard summary with all metrics
   */
  getSummary: async (): Promise<DashboardSummary> => {
    const response = await apiClient.get<DashboardSummary>("/admin/analytics/dashboard");
    return response.data;
  },

  /**
   * GET /admin/analytics/conversations/metrics
   * Get detailed conversation metrics
   */
  getConversationMetrics: async (): Promise<ConversationMetrics> => {
    const response = await apiClient.get<ConversationMetrics>("/admin/analytics/conversations/metrics");
    return response.data;
  },

  /**
   * GET /admin/analytics/contacts/metrics
   * Get detailed contact metrics
   */
  getContactMetrics: async (): Promise<ContactMetrics> => {
    const response = await apiClient.get<ContactMetrics>("/admin/analytics/contacts/metrics");
    return response.data;
  },

  /**
   * GET /admin/analytics/ai/performance
   * Get AI performance metrics
   */
  getAIMetrics: async (): Promise<AIPerformanceMetrics> => {
    const response = await apiClient.get<AIPerformanceMetrics>("/admin/analytics/ai/performance");
    return response.data;
  },
};

// ============================================================================
// LEADS (7 endpoints)
// ============================================================================

export const leadsApi = {
  /**
   * GET /admin/leads
   * Get paginated leads with filters (Franco's sales pipeline)
   */
  getAll: async (params?: GetLeadsParams): Promise<GetLeadsResponse> => {
    const response = await apiClient.get<GetLeadsResponse>("/admin/leads", { params });
    return response.data;
  },

  /**
   * GET /admin/leads/:id
   * Get single lead with contact and assigned user
   */
  getById: async (id: string): Promise<LeadWithRelations> => {
    const response = await apiClient.get<LeadWithRelations>(`/admin/leads/${id}`);
    return response.data;
  },

  /**
   * POST /admin/leads
   * Create new lead (opportunity detected)
   */
  create: async (data: CreateLeadRequest): Promise<LeadWithRelations> => {
    const response = await apiClient.post<LeadWithRelations>("/admin/leads", data);
    return response.data;
  },

  /**
   * PUT /admin/leads/:id
   * Update lead information
   */
  update: async (id: string, data: UpdateLeadRequest): Promise<LeadWithRelations> => {
    const response = await apiClient.put<LeadWithRelations>(`/admin/leads/${id}`, data);
    return response.data;
  },

  /**
   * PUT /admin/leads/:id/status
   * Update lead status (NEW → CONTACTED → QUOTE_SENT → NEGOTIATING → WON/LOST)
   */
  updateStatus: async (id: string, data: UpdateLeadStatusRequest): Promise<LeadWithRelations> => {
    const response = await apiClient.put<LeadWithRelations>(`/admin/leads/${id}/status`, data);
    return response.data;
  },

  /**
   * DELETE /admin/leads/:id
   * Delete lead
   */
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/leads/${id}`);
  },

  /**
   * GET /admin/leads/stats
   * Get sales pipeline statistics (conversion rates, revenue, etc.)
   */
  getStats: async (): Promise<LeadPipelineStats> => {
    const response = await apiClient.get<LeadPipelineStats>("/admin/leads/stats");
    return response.data;
  },

  /**
   * GET /admin/leads (alias for getAll)
   * Get paginated leads with filters
   */
  list: async (params?: GetLeadsParams): Promise<GetLeadsResponse> => {
    const response = await apiClient.get<GetLeadsResponse>("/admin/leads", { params });
    return response.data;
  },

  /**
   * POST /admin/leads/:id/assign
   * Assign lead to a user
   */
  assign: async (id: string, userId: string): Promise<LeadWithRelations> => {
    const response = await apiClient.post<LeadWithRelations>(`/admin/leads/${id}/assign`, { userId });
    return response.data;
  },
};

// ============================================================================
// ORDERS (7 endpoints)
// ============================================================================

export const ordersApi = {
  /**
   * GET /admin/orders
   * Get paginated orders with filters (Aldo's fulfillment tracking)
   */
  getAll: async (params?: GetOrdersParams): Promise<GetOrdersResponse> => {
    const response = await apiClient.get<GetOrdersResponse>("/admin/orders", { params });
    return response.data;
  },

  /**
   * GET /admin/orders/:id
   * Get single order with contact and products
   */
  getById: async (id: string): Promise<OrderWithRelations> => {
    const response = await apiClient.get<OrderWithRelations>(`/admin/orders/${id}`);
    return response.data;
  },

  /**
   * POST /admin/orders
   * Create new order
   */
  create: async (data: CreateOrderRequest): Promise<OrderWithRelations> => {
    const response = await apiClient.post<OrderWithRelations>("/admin/orders", data);
    return response.data;
  },

  /**
   * PUT /admin/orders/:id
   * Update order information
   */
  update: async (id: string, data: UpdateOrderRequest): Promise<OrderWithRelations> => {
    const response = await apiClient.put<OrderWithRelations>(`/admin/orders/${id}`, data);
    return response.data;
  },

  /**
   * PUT /admin/orders/:id/status
   * Update order status (CONFIRMED → PROCESSING → DISPATCHED → DELIVERED)
   */
  updateStatus: async (id: string, data: UpdateOrderStatusRequest): Promise<OrderWithRelations> => {
    const response = await apiClient.put<OrderWithRelations>(`/admin/orders/${id}/status`, data);
    return response.data;
  },

  /**
   * DELETE /admin/orders/:id
   * Delete order
   */
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/orders/${id}`);
  },

  /**
   * GET /admin/orders/stats
   * Get order fulfillment statistics (revenue, top products, etc.)
   */
  getStats: async (): Promise<OrderFulfillmentStats> => {
    const response = await apiClient.get<OrderFulfillmentStats>("/admin/orders/stats");
    return response.data;
  },

  /**
   * GET /admin/orders (alias for getAll)
   * Get paginated orders with filters
   */
  list: async (params?: GetOrdersParams): Promise<GetOrdersResponse> => {
    const response = await apiClient.get<GetOrdersResponse>("/admin/orders", { params });
    return response.data;
  },

  /**
   * PUT /admin/orders/:id/tracking
   * Update order tracking information
   */
  updateTracking: async (id: string, data: { trackingNumber: string; carrier: string }): Promise<OrderWithRelations> => {
    const response = await apiClient.put<OrderWithRelations>(`/admin/orders/${id}/tracking`, data);
    return response.data;
  },
};

// ============================================================================
// CONFIGURATION (4 endpoints)
// ============================================================================

export const configApi = {
  /**
   * GET /admin/configuration
   * Get all configurations with filters
   */
  getAll: async (params?: GetConfigurationsParams): Promise<Configuration[]> => {
    const response = await apiClient.get<Configuration[]>("/admin/configuration", { params });
    return response.data;
  },

  /**
   * GET /admin/configuration/key/:key
   * Get single configuration by key
   */
  getByKey: async (key: string): Promise<Configuration> => {
    const response = await apiClient.get<Configuration>(`/admin/configuration/key/${key}`);
    return response.data;
  },

  /**
   * POST /admin/configuration
   * Create new configuration
   */
  create: async (data: CreateConfigurationRequest): Promise<Configuration> => {
    const response = await apiClient.post<Configuration>("/admin/configuration", data);
    return response.data;
  },

  /**
   * PUT /admin/configuration/:id
   * Update configuration
   */
  update: async (id: string, data: UpdateConfigurationRequest): Promise<Configuration> => {
    const response = await apiClient.put<Configuration>(`/admin/configuration/${id}`, data);
    return response.data;
  },

  /**
   * GET /admin/configuration/ai/settings
   * Get AI configuration
   */
  getAI: async (): Promise<any> => {
    const response = await apiClient.get<any>("/admin/configuration/ai/settings");
    return response.data;
  },

  /**
   * PUT /admin/configuration/ai/settings
   * Update AI configuration
   */
  updateAI: async (data: any): Promise<any> => {
    const response = await apiClient.put<any>("/admin/configuration/ai/settings", data);
    return response.data;
  },

  /**
   * GET /admin/configuration/channel/:channel
   * Get channel configuration
   */
  getChannel: async (channel: string): Promise<any> => {
    const response = await apiClient.get<any>(`/admin/configuration/channel/${channel}`);
    return response.data;
  },

  /**
   * PUT /admin/configuration/channel/:channel
   * Update channel configuration
   */
  updateChannel: async (channel: string, data: any): Promise<any> => {
    const response = await apiClient.put<any>(`/admin/configuration/channel/${channel}`, data);
    return response.data;
  },

  /**
   * GET /admin/configuration/pricing/settings
   * Get pricing configuration
   */
  getPricing: async (): Promise<any> => {
    const response = await apiClient.get<any>("/admin/configuration/pricing/settings");
    return response.data;
  },

  /**
   * PUT /admin/configuration/pricing/settings
   * Update pricing configuration
   */
  updatePricing: async (data: any): Promise<any> => {
    const response = await apiClient.put<any>("/admin/configuration/pricing/settings", data);
    return response.data;
  },

  /**
   * GET /admin/configuration/system/settings
   * Get system configuration
   */
  getSystem: async (): Promise<any> => {
    const response = await apiClient.get<any>("/admin/configuration/system/settings");
    return response.data;
  },

  /**
   * PUT /admin/configuration/system/settings
   * Update system configuration
   */
  updateSystem: async (data: any): Promise<any> => {
    const response = await apiClient.put<any>("/admin/configuration/system/settings", data);
    return response.data;
  },
};

// ============================================================================
// EXPORT ALL API MODULES
// ============================================================================

export const api = {
  auth: authApi,
  users: usersApi,
  conversations: conversationsApi,
  contacts: contactsApi,
  knowledge: knowledgeApi,
  analytics: analyticsApi,
  leads: leadsApi,
  orders: ordersApi,
  config: configApi,
};

export default api;
