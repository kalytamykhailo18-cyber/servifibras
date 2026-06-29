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

  /**
   * POST /auth/refresh
   * Exchange a refresh token for a new access+refresh pair. Used by the
   * client interceptor; rarely called directly by feature code.
   */
  refresh: async (refreshToken: string): Promise<{
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  }> => {
    const response = await apiClient.post<any>("/auth/refresh", { refreshToken });
    return response.data;
  },

  /**
   * POST /auth/logout
   * Revoke the refresh family server-side. Call this from the auth-store
   * logout action so the family is invalidated on the backend, then clear
   * local tokens.
   */
  logout: async (refreshToken: string | null): Promise<void> => {
    if (!refreshToken) return;
    try {
      await apiClient.post("/auth/logout", { refreshToken });
    } catch {
      // Local logout still proceeds even if the server call fails — the
      // token might already be invalid, or the server is unreachable.
    }
  },
};

// ============================================================================
// USERS (1 endpoint)
// ============================================================================

export const usersApi = {
  /**
   * GET /admin/users
   * Get all users (active by default; pass activeOnly=false to include
   * deactivated accounts).
   */
  list: async (opts?: { activeOnly?: boolean }): Promise<User[]> => {
    const qs = opts?.activeOnly === false ? '?activeOnly=false' : '';
    const response = await apiClient.get<any>(`/admin/users${qs}`);
    return response.data?.data ?? response.data;
  },

  /** ADMIN-only — create a new user. Email/username are normalized server-side. */
  create: async (input: {
    email: string; username: string; name: string;
    role: string; password: string; active?: boolean;
  }): Promise<User> => {
    const r = await apiClient.post<any>('/admin/users', input);
    return r.data?.data ?? r.data;
  },
  update: async (id: string, input: Partial<{
    email: string; username: string; name: string;
    role: string; password: string; active: boolean;
  }>): Promise<User> => {
    const r = await apiClient.put<any>(`/admin/users/${id}`, input);
    return r.data?.data ?? r.data;
  },
  delete: async (id: string): Promise<{ ok: boolean; reason?: string }> => {
    const r = await apiClient.delete<any>(`/admin/users/${id}`);
    return { ok: r.data?.success === true, reason: r.data?.error };
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
    // Response interceptor already unwraps {success, data} → data, so the
    // conversation sits at response.data (NOT response.data.data).
    const response = await apiClient.get<ConversationWithRelations>(
      `/admin/conversations/${id}`,
    );
    return response.data;
  },

  /**
   * GET /admin/conversations/:id/summary
   * Fetch the AI-generated conversational summary. Returns null when
   * the conversation hasn't accumulated enough customer messages to be
   * worth summarizing yet.
   */
  getSummary: async (id: string): Promise<{
    summary: string;
    products: string[];
    status: string;
    keyFacts: string[];
    updatedAt: string;
    messageCount: number;
  } | null> => {
    const response = await apiClient.get<{
      summary: string;
      products: string[];
      status: string;
      keyFacts: string[];
      updatedAt: string;
      messageCount: number;
    } | null>(`/admin/conversations/${id}/summary`);
    return response.data;
  },

  /**
   * POST /admin/conversations/:id/summary/regenerate
   * Force a Claude-regenerate of the summary now. The actual write
   * happens detached on the backend, so callers should refetch shortly
   * after or wait for the conversation:summary:updated socket event.
   */
  regenerateSummary: async (id: string): Promise<void> => {
    await apiClient.post(`/admin/conversations/${id}/summary/regenerate`);
  },

  /**
   * GET /admin/conversations/:id/score
   * Read the current quality score row for this conversation. Returns
   * null when the conversation hasn't been scored yet.
   */
  getScore: async (id: string): Promise<{
    score: number | null;
    strengths: string[];
    improvement: { reason: string; originalSnippet: string; suggestedRewrite: string } | null;
    missedOpportunity: { detected: boolean; reason: string | null };
    severeFlag: string;
    severeReason: string | null;
    updatedAt: string;
  } | null> => {
    const response = await apiClient.get<any>(`/admin/conversations/${id}/score`);
    return response.data;
  },

  /**
   * POST /admin/conversations/:id/score/regenerate
   * Force a Claude rescore now, bypassing the debounce. The actual
   * write happens detached; refetch or wait for the
   * quality:score_ready socket event.
   */
  regenerateScore: async (id: string): Promise<void> => {
    await apiClient.post(`/admin/conversations/${id}/score/regenerate`);
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
   * GET /admin/conversations/:id/pdf — fetches the conversation PDF as
   * a blob URL the browser can open in a new tab.
   */
  getPdfBlobUrl: async (id: string): Promise<string> => {
    const r = await apiClient.get(`/admin/conversations/${id}/pdf`, { responseType: 'blob' });
    return URL.createObjectURL(r.data as Blob);
  },

  /**
   * PUT /admin/conversations/:id/ai-state
   * Pause or resume the AI on this conversation. While paused the inbound
   * pipeline still saves customer messages and runs lead detection, but
   * Claude (and the deterministic auto-reply) does not respond.
   */
  setAiState: async (
    id: string,
    paused: boolean,
  ): Promise<{ id: string; aiPaused: boolean; aiPausedAt: string | null; aiPausedBy: string | null }> => {
    const response = await apiClient.put<any>(
      `/admin/conversations/${id}/ai-state`,
      { paused },
    );
    return response.data?.data ?? response.data;
  },

  /**
   * POST /admin/conversations/:id/upload (multipart/form-data)
   * Send a file attachment with optional caption. Returns the saved
   * message id + attachment metadata.
   */
  /**
   * GET /admin/quick-replies — librería global de chips reusables
   * (HAY STOCK, ENVIOS, MASILLA 10 MIN, etc.) que se insertan al
   * cursor en la caja de respuesta y alimentan el system prompt de la
   * IA cuando feedAi=true.
   */
  listQuickReplies: async (): Promise<Array<{
    id: string;
    label: string;
    body: string;
    category: string | null;
    active: boolean;
    feedAi: boolean;
    sortOrder: number;
    hitCount: number;
    lastUsedAt: string | null;
  }>> => {
    const r = await apiClient.get<any>('/admin/quick-replies?activeOnly=true');
    return r.data?.data ?? r.data;
  },

  /** POST /admin/quick-replies/:id/mark-used — bump usage counter. */
  markQuickReplyUsed: async (id: string): Promise<void> => {
    await apiClient.post(`/admin/quick-replies/${id}/mark-used`);
  },

  /**
   * POST /admin/conversations/:id/redact
   * "Redactar con IA" — improves the operator's draft (or proposes a fresh
   * reply if the draft is empty). Returns `success:false` with a friendly
   * Spanish reason when Claude isn't configured.
   */
  redactWithAi: async (
    id: string,
    draft: string,
    mode: 'improve' | 'suggest' = 'improve',
  ): Promise<{ success: true; data: { text: string } } | { success: false; reason: string }> => {
    const r = await apiClient.post<any>(
      `/admin/conversations/${id}/redact`,
      { draft, mode },
    );
    return r.data;
  },

  /** Admin-only — full list including inactive templates. */
  listAllQuickReplies: async (): Promise<Array<{
    id: string;
    label: string;
    body: string;
    category: string | null;
    active: boolean;
    feedAi: boolean;
    sortOrder: number;
    hitCount: number;
    lastUsedAt: string | null;
  }>> => {
    const r = await apiClient.get<any>('/admin/quick-replies');
    return r.data?.data ?? r.data;
  },
  createQuickReply: async (input: {
    label: string; body: string; category?: string | null;
    active?: boolean; feedAi?: boolean; sortOrder?: number;
  }) => {
    const r = await apiClient.post<any>('/admin/quick-replies', input);
    return r.data?.data ?? r.data;
  },
  updateQuickReply: async (id: string, input: Partial<{
    label: string; body: string; category: string | null;
    active: boolean; feedAi: boolean; sortOrder: number;
  }>) => {
    const r = await apiClient.put<any>(`/admin/quick-replies/${id}`, input);
    return r.data?.data ?? r.data;
  },
  deleteQuickReply: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/quick-replies/${id}`);
  },

  uploadAttachment: async (
    id: string,
    file: File,
    caption?: string,
  ): Promise<{
    messageId: string;
    timestamp: string;
    attachment: {
      url: string; name: string; mime: string; size: number; contentType: string;
    };
    caption: string;
  }> => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (caption && caption.length > 0) fd.append('caption', caption);
    // Override the apiClient's default `application/json` so the browser
    // can set the multipart boundary. Setting to `undefined` (rather than
    // a literal string) is the documented axios escape hatch.
    const r = await apiClient.post<any>(
      `/admin/conversations/${id}/upload`,
      fd,
      { headers: { 'Content-Type': undefined as any } },
    );
    return r.data?.data ?? r.data;
  },

  /**
   * POST /admin/conversations/:id/send-quote/:quoteId
   * Render the persisted quote as a PDF and dispatch it to the customer
   * through the channel. WhatsApp gets a native document; webchat / IG /
   * FB get a text message with a public download link. Saves a Message
   * row regardless.
   */
  sendQuotePdf: async (
    id: string,
    quoteId: string,
    caption?: string,
  ): Promise<{
    messageId: string;
    attachmentUrl: string;
    attachmentName: string;
  }> => {
    const r = await apiClient.post<any>(
      `/admin/conversations/${id}/send-quote/${quoteId}`,
      { caption: caption ?? '' },
    );
    return r.data?.data ?? r.data;
  },

  /**
   * POST /admin/conversations/:id/send-transcript
   * Render the conversation transcript as PDF and dispatch via the same
   * channel pipeline as send-quote. Useful at end-of-conversation when the
   * customer asks for a copy.
   */
  sendTranscript: async (
    id: string,
    caption?: string,
  ): Promise<{
    messageId: string;
    attachmentUrl: string;
    attachmentName: string;
  }> => {
    const r = await apiClient.post<any>(
      `/admin/conversations/${id}/send-transcript`,
      { caption: caption ?? '' },
    );
    return r.data?.data ?? r.data;
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
   * GET /admin/conversations/stats/summary
   * Get conversation statistics and metrics
   */
  getStats: async (): Promise<ConversationMetrics> => {
    const response = await apiClient.get<ConversationMetrics>("/admin/conversations/stats/summary");
    return response.data;
  },

  /**
   * POST /admin/conversations/:id/transfer
   * Transfer a conversation to another user with an optional internal note.
   * The note is staff-only — never sent to the customer's channel.
   */
  transfer: async (
    id: string,
    data: { targetUserId: string; note?: string },
  ): Promise<{ success: boolean; note: { id: string; content: string; createdAt: string; authorId: string } | null }> => {
    const response = await apiClient.post<{
      success: boolean;
      note: { id: string; content: string; createdAt: string; authorId: string } | null;
    }>(`/admin/conversations/${id}/transfer`, data);
    return response.data;
  },

  /**
   * GET /admin/conversations/:id/internal-notes
   * Staff-only notes attached to the conversation.
   */
  listInternalNotes: async (
    id: string,
  ): Promise<Array<{ id: string; conversationId: string; authorId: string; authorName: string; content: string; createdAt: string }>> => {
    const response = await apiClient.get<Array<{
      id: string; conversationId: string; authorId: string; authorName: string; content: string; createdAt: string;
    }>>(`/admin/conversations/${id}/internal-notes`);
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
   * GET /admin/analytics/ml-account-split — Bloque B item 1.
   * Returns the per-cuenta ML breakdown (conversations, active,
   * new in range, AI replies). Untagged-legacy rows surface as a
   * separate bucket so the dashboard can show migration progress.
   */
  /**
   * GET /admin/analytics/ventas-unificadas?range=today|week|month
   * Bloque B item 4 — rolled-up sales across ML cuenta 1/2, TN and
   * CRM-manual into a single payload.
   */
  getVentasUnificadas: async (range: 'today' | 'week' | 'month' = 'today'): Promise<{
    range: 'today' | 'week' | 'month';
    fromIso: string;
    toIso: string;
    sources: Array<{
      source: 'ML_CUENTA_1' | 'ML_CUENTA_2' | 'TIENDANUBE' | 'MANUAL';
      label: string;
      byCurrency: Array<{ currency: string; count: number; amount: number }>;
      totalArsLike: number | null;
      count: number;
    }>;
    daily: Array<{
      date: string;
      sources: Record<'ML_CUENTA_1' | 'ML_CUENTA_2' | 'TIENDANUBE' | 'MANUAL', number>;
    }>;
    notes: string[];
  }> => {
    const r = await apiClient.get<any>(`/admin/analytics/ventas-unificadas?range=${range}`);
    return r.data?.data ?? r.data;
  },

  /**
   * Bloque B item 5 — click-detail drilldown for the ventas
   * unificadas card. Returns the per-source order list for the
   * given range.
   */
  getVentasUnificadasDetail: async (
    range: 'today' | 'week' | 'month',
    source: 'ML_CUENTA_1' | 'ML_CUENTA_2' | 'TIENDANUBE' | 'MANUAL',
    limit = 50,
  ): Promise<{
    range: string;
    source: string;
    label: string;
    fromIso: string;
    toIso: string;
    orders: Array<{
      id: string;
      orderNumber: string;
      createdAt: string;
      customerName: string | null;
      amount: number;
      currency: string;
      carrier: string | null;
      itemsCount: number;
      itemsSummary: string;
    }>;
    truncated: boolean;
  }> => {
    const r = await apiClient.get<any>(
      `/admin/analytics/ventas-unificadas/detail?range=${range}&source=${source}&limit=${limit}`,
    );
    return r.data?.data ?? r.data;
  },

  /**
   * Bloque B item 6 — push the unified-sales snapshot for the given
   * range into the Servifibras shared Drive folder. Returns the share
   * link the UI shows the operator. `mocked: true` means the backend
   * ran in GOOGLE_DRIVE_MOCK mode (e2e / dev) and the link is a stub.
   */
  uploadVentasUnificadasToDrive: async (
    range: 'today' | 'week' | 'month' = 'today',
  ): Promise<{
    success: boolean;
    data?: { fileId: string; fileName: string; webViewLink: string; mocked: boolean };
    reason?: string;
    error?: string;
  }> => {
    const r = await apiClient.post<any>(
      `/admin/analytics/ventas-unificadas/upload-drive?range=${range}`,
      {},
    );
    // The axios response interceptor auto-unwraps {success, data}
    // envelopes when they're the only two keys, so on the happy path
    // `r.data` already IS the inner result. Detect that and re-wrap
    // so callers see a consistent shape; failure responses ship a
    // third key (reason/error) and pass through unwrapped.
    const body = r.data;
    if (body && typeof body === 'object' && 'fileId' in body && 'webViewLink' in body) {
      return { success: true, data: body };
    }
    return body;
  },

  /**
   * Marcos 2026-06-12: dispatch history per mensajería. Bounds are
   * ISO instants from the caller; presets resolved client-side.
   */
  /**
   * Marcos 2026-06-18: team-performance leaderboard. Per-user totals
   * (orders + invoiced ARS + conversations handled + response-time
   * averages) over an ISO window. Returns one row per active user so
   * the comparison table stays stable even on quiet days.
   */
  getTeamPerformance: async (params: { from: string; to: string }): Promise<{
    fromIso: string;
    toIso: string;
    users: Array<{
      userId: string;
      name: string;
      email: string;
      role: string;
      ordersCreated: number;
      invoicedArs: number;
      conversationsHandled: number;
      avgFirstResponseSeconds: number | null;
      avgReplyLatencySeconds: number | null;
    }>;
  }> => {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    const r = await apiClient.get<any>(`/admin/analytics/team-performance?${qs.toString()}`);
    return r.data?.data ?? r.data;
  },
  getDispatchStats: async (params: { from: string; to: string }): Promise<{
    fromIso: string;
    toIso: string;
    total: number;
    totalShippingCost: number;
    /** Estimated total to pay to couriers, computed from the
     *  admin-curated tarifas table (per carrier + zone × dispatch
     *  count). Null when no tariffs are loaded yet. */
    totalEstimatedCost: number | null;
    rowsWithoutTariff: number;
    byCarrier: Array<{
      carrier: string;
      count: number;
      totalShippingCost: number;
      totalEstimatedCost: number | null;
      rowsWithoutTariff: number;
      byZone: Array<{
        zone: string;
        count: number;
        totalShippingCost: number;
        estimatedCost: number | null;
        tariffPerPackage: number | null;
      }>;
      orders: Array<{
        rowKey: string;
        orderNumber: string | null;
        customer: string | null;
        dispatchedAt: string;
        amount: number | null;
        currency: string | null;
        shippingCost: number | null;
        shippingZone: string | null;
      }>;
    }>;
  }> => {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    const r = await apiClient.get<any>(`/admin/analytics/dispatch-stats?${qs.toString()}`);
    return r.data?.data ?? r.data;
  },

  /**
   * Marcos 2026-06-22: costo de reposiciones por responsable. ADMIN-
   * only. Devuelve cuántos pedidos de reposición carga cada operador
   * de depósito y la suma de shippingCost (= la plata que perdió
   * Servifibras en re-despachos por errores de ese responsable).
   */
  getReposicionByResponsible: async (params: { from: string; to: string }): Promise<{
    fromIso: string;
    toIso: string;
    total: number;
    totalCost: number;
    currency: string;
    byResponsible: Array<{
      responsibleId: string | null;
      name: string;
      count: number;
      totalCost: number;
    }>;
  }> => {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    const r = await apiClient.get<any>(`/admin/analytics/reposicion-by-responsible?${qs.toString()}`);
    return r.data?.data ?? r.data;
  },

  /**
   * Marcos 2026-06-23: monto a cobrar a cada mensajería por paquetes
   * perdidos (returnState=LOST). Agrupa por carrier responsable del
   * retorno y suma productValue. ADMIN-only.
   */
  getLostByCarrier: async (params: { from: string; to: string }): Promise<{
    fromIso: string;
    toIso: string;
    total: number;
    totalToCollect: number;
    currency: string;
    byCarrier: Array<{ carrier: string; count: number; totalToCollect: number }>;
  }> => {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    const r = await apiClient.get<any>(`/admin/analytics/lost-by-carrier?${qs.toString()}`);
    return r.data?.data ?? r.data;
  },

  getMlAccountSplit: async (params?: { since?: string; until?: string }): Promise<{
    range: { since: string | null; until: string | null };
    accounts: Array<{
      mlAccountKey: string | null;
      label: string;
      totalConversations: number;
      activeConversations: number;
      newConversations: number;
      aiReplies: number;
    }>;
  }> => {
    const qs = new URLSearchParams();
    if (params?.since) qs.set('since', params.since);
    if (params?.until) qs.set('until', params.until);
    const url = `/admin/analytics/ml-account-split${qs.toString() ? `?${qs.toString()}` : ''}`;
    const r = await apiClient.get<any>(url);
    return r.data?.data ?? r.data;
  },

  /**
   * GET /admin/analytics/role/atencion — Brenda's metrics cut.
   */
  // Marcos 2026-06-29: opts.userId opcional narrowea la métrica al
  // agente puntual (chip click en el header). Sin arg = aggregado.
  getAtencionMetrics: async (opts?: { userId?: string }): Promise<{
    alertThresholdMin: number;
    queueWaitingOverThreshold: number;
    avgFirstResponseSeconds: number | null;
    unresolvedByAI: Array<{
      conversationId: string; contactName: string | null; channel: string;
      lastMessage: string | null; escalatedAt: string | null; waitingMinutes: number;
    }>;
  }> => {
    const qs = opts?.userId ? `?userId=${encodeURIComponent(opts.userId)}` : '';
    const r = await apiClient.get<any>(`/admin/analytics/role/atencion${qs}`);
    return r.data?.data ?? r.data;
  },

  getVentasMetrics: async (opts?: { userId?: string }): Promise<{
    mayoristasToday: number;
    mayoristasWeek: number;
    quoteFollowupMinutes: number;
    quotesWaitingOverThreshold: Array<{
      leadId: string; contactName: string | null; productInterest: string | null;
      estimatedValue: number | null; sentAt: string; idleMinutes: number;
    }>;
    conversionRate30d: number;
    conversionRate30dDetail: { won: number; lost: number; openQuoted: number };
  }> => {
    const qs = opts?.userId ? `?userId=${encodeURIComponent(opts.userId)}` : '';
    const r = await apiClient.get<any>(`/admin/analytics/role/ventas${qs}`);
    return r.data?.data ?? r.data;
  },

  getLogisticaMetrics: async (opts?: { userId?: string }): Promise<{
    pendingOrders: number;
    overdueOrders: number;
    overdueThresholdHours: number;
    lowStockProducts: number;
    conversationsAssigned: number;
    dispatchedRecent: number;
    pendingTop: Array<{
      orderId: string;
      orderNumber: string;
      contactName: string | null;
      amount: number;
      currency: string;
      ageHours: number;
      status: string;
    }>;
  }> => {
    const qs = opts?.userId ? `?userId=${encodeURIComponent(opts.userId)}` : '';
    const r = await apiClient.get<any>(`/admin/analytics/role/logistica${qs}`);
    return r.data?.data ?? r.data;
  },

  /**
   * GET /admin/analytics/role/admin — Admin-only cut.
   */
  getAdminRoleMetrics: async (): Promise<{
    wow: {
      conversations: { thisWeek: number; lastWeek: number; deltaPct: number };
      leads:         { thisWeek: number; lastWeek: number; deltaPct: number };
      orders:        { thisWeek: number; lastWeek: number; deltaPct: number };
    };
    bestConvertingChannel: { channel: string | null; rate: number; total: number; won: number };
    topSoldProducts: Array<{ name: string; quantity: number; orderCount: number }>;
    claudeCostPerConversation: { costUsd: number | null; reason: string };
  }> => {
    const r = await apiClient.get<any>("/admin/analytics/role/admin");
    return r.data?.data ?? r.data;
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
   * GET /admin/leads/stats/pipeline
   * Get sales pipeline statistics (conversion rates, revenue, etc.)
   */
  getStats: async (): Promise<LeadPipelineStats> => {
    const response = await apiClient.get<LeadPipelineStats>("/admin/leads/stats/pipeline");
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
   * Marcos 2026-06-12: orders that have been armed but not yet
   * invoiced. Drives the "Pendientes de facturación" tab on the
   * Pedidos page.
   */
  pendingInvoicing: async (): Promise<Array<{
    id: string;
    orderNumber: string;
    contact: { id: string; name: string | null };
    amount: number;
    currency: string;
    sectionOverride: string | null;
    carrier: string | null;
    createdAt: string;
    notes: string | null;
  }>> => {
    const r = await apiClient.get<any>(`/admin/orders/pending-invoicing`);
    return r.data?.data ?? r.data ?? [];
  },
  markInvoiced: async (id: string, invoiced: boolean = true): Promise<{ id: string; orderNumber: string; invoicedAt: string | null }> => {
    const r = await apiClient.post<any>(`/admin/orders/${id}/mark-invoiced`, { invoiced });
    return r.data?.data ?? r.data;
  },

  /** Marcos 2026-06-18: DEVOLUCION rows whose package hasn't been
   *  physically returned yet. Used by the "Pendientes de regreso"
   *  tab on /orders. */
  pendingReturns: async (): Promise<Array<{
    id: string;
    orderNumber: string;
    orderType: 'SALE' | 'REPOSICION' | 'DEVOLUCION';
    /** Marcos 2026-06-23: PENDING o LOST (el panel sigue mostrando
     *  ambos, con badge distinto). */
    returnState: 'PENDING' | 'LOST';
    contact: { id: string; name: string | null };
    carrier: string | null;
    shippingZone: string | null;
    shippingCost: number | null;
    /** Marcos 2026-06-23: mensajería que trae el producto de vuelta
     *  (REPOSICION CON DEVOLUCION). Cuando el estado es LOST esta es
     *  la mensajería que tiene que devolver la plata. En DEVOLUCION
     *  pura es null porque usa `carrier`. */
    returnCarrier: string | null;
    returnShippingCost: number | null;
    /** Marcos 2026-06-18 PM: valor del producto. Para REPOSICION sale
     *  del campo productValue; para DEVOLUCION histórica suma líneas. */
    productCost: number | null;
    productLabel: string | null;
    notes: string | null;
    createdAt: string;
    createdBy: { id: string; name: string } | null;
  }>> => {
    const r = await apiClient.get<any>(`/admin/orders/pending-returns`);
    return r.data?.data ?? r.data ?? [];
  },
  markReturned: async (id: string, returned: boolean = true): Promise<{ id: string; orderNumber: string; returnedAt: string | null }> => {
    const r = await apiClient.post<any>(`/admin/orders/${id}/mark-returned`, { returned });
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-23: cierre del retorno como PERDIDO — el courier
   * no trajo el paquete. Stampea lostAt + returnState=LOST y el valor
   * del producto queda como monto a cobrar a la mensajería.
   */
  markLost: async (id: string): Promise<{ id: string; orderNumber: string; lostAt: string | null }> => {
    const r = await apiClient.post<any>(`/admin/orders/${id}/mark-lost`, {});
    return r.data?.data ?? r.data;
  },

  /**
   * Marcos 2026-06-21: cancelar un pedido (en vez de eliminar). El
   * motivo es obligatorio (min 5 chars; el backend lo rechaza vacio).
   * Stampea cancelledAt + cancelledById + cancellationReason para
   * que quede registro de quien lo cancelo y por que.
   */
  cancel: async (id: string, reason: string): Promise<{
    id: string;
    orderNumber: string;
    status: string;
    cancelledAt: string | null;
    cancelledById: string | null;
    cancellationReason: string | null;
  }> => {
    const r = await apiClient.post<any>(`/admin/orders/${id}/cancel`, { reason });
    return r.data?.data ?? r.data;
  },

  /** Marcos 2026-06-15: render an order as a printable PDF (same
   *  letterhead as Presupuestos) including the shipping block.
   *  Returns a Blob URL the browser can open in a new tab. */
  getPdfBlobUrl: async (id: string): Promise<string> => {
    const r = await apiClient.get(`/admin/orders/${id}/pdf`, { responseType: 'blob' });
    return URL.createObjectURL(r.data as Blob);
  },

  /** Marcos 2026-06-16: Zebra 10×15 cm shipping-label PDF for the
   *  warehouse's thermal printer. `bultos` (Marcos 2026-06-17) makes
   *  the endpoint emit one labelled page per bulto (BULTO 1/N, …, N/N). */
  getEtiquetaBlobUrl: async (id: string, bultos: number = 1): Promise<string> => {
    const r = await apiClient.get(`/admin/orders/${id}/etiqueta`, {
      params: { bultos: Math.max(1, Math.min(50, Math.floor(bultos))) },
      responseType: 'blob',
    });
    return URL.createObjectURL(r.data as Blob);
  },

  /**
   * Marcos 2026-06-20: ¿esta etiqueta ya fue impresa antes? El UI
   * lo consulta antes de imprimir para mostrar 'Re-imprimir
   * etiqueta (N veces)' en vez de 'Imprimir', así el operador sabe
   * que no es la primera vez y no re-arma el paquete por error.
   */
  getEtiquetaStatus: async (id: string): Promise<{
    orderId: string;
    printed: boolean;
    printedAt: string | null;
    printCount: number;
  }> => {
    const r = await apiClient.get<any>(`/admin/orders/${id}/etiqueta/status`);
    return r.data?.data ?? r.data;
  },

  /**
   * GET /admin/orders/stats/summary
   * Get order fulfillment statistics (revenue, top products, etc.)
   */
  getStats: async (): Promise<OrderFulfillmentStats> => {
    const response = await apiClient.get<OrderFulfillmentStats>("/admin/orders/stats/summary");
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

  /**
   * GET /admin/conversations/:id/orders
   * Lists the orders that were registered from this conversation, most
   * recent first. Open to all operator roles (the global /admin/orders
   * is ADMIN+LOGISTICA only).
   */
  byConversation: async (conversationId: string): Promise<OrderWithRelations[]> => {
    const r = await apiClient.get<{ success: boolean; data: OrderWithRelations[]; total: number }>(
      `/admin/conversations/${conversationId}/orders`,
    );
    return r.data?.data ?? [];
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
   * GET /admin/configuration/lucas-prompt
   * Read the currently-loaded Lucas system prompt + provenance
   * (source = 'db' | 'file' | 'none'). Used by the IA Settings tab.
   */
  getLucasPrompt: async (): Promise<{
    content: string | null;
    source: 'db' | 'file' | 'none';
    updatedAt: string | null;
    length: number;
  }> => {
    const r = await apiClient.get<any>('/admin/configuration/lucas-prompt');
    return r.data?.data ?? r.data;
  },

  /**
   * PUT /admin/configuration/lucas-prompt
   * Persist a new Lucas system prompt and hot-reload ClaudeService so
   * the next reply uses it. No server restart needed.
   */
  updateLucasPrompt: async (
    content: string,
  ): Promise<{
    content: string | null;
    source: 'db' | 'file' | 'none';
    updatedAt: string | null;
    length: number;
  }> => {
    const r = await apiClient.put<any>('/admin/configuration/lucas-prompt', { content });
    return r.data?.data ?? r.data;
  },

  /**
   * POST /admin/configuration/lucas-prompt/reset
   * Drop the DB override; fall back to the on-disk default.
   */
  resetLucasPrompt: async (): Promise<{
    content: string | null;
    source: 'db' | 'file' | 'none';
    updatedAt: string | null;
    length: number;
  }> => {
    const r = await apiClient.post<any>('/admin/configuration/lucas-prompt/reset');
    return r.data?.data ?? r.data;
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
   * Bloque C — Marcos 2026-06-06: Logística favorite Drive links +
   * notas operativas (header of the daily auto-Excel).
   */
  getLogistica: async (): Promise<{
    linksFavoritos: Array<{ label: string; url: string }>;
    notasOperativas: string;
    /** Marcos 2026-06-10: editable list of flex couriers; null/undefined
     *  when the config row hasn't been set yet (UI falls back to the
     *  daily-logistica endpoint to pick up env defaults). */
    flexCouriers?: string[];
    /** Marcos 2026-06-10: per-family pickup cutoff hours (0-23 local
     *  ART). null disables the cutoff banner for that family. */
    cutoffHours?: {
      colecta?: number | null;
      flex?: number | null;
      motos?: number | null;
      micros?: number | null;
    };
  }> => {
    const r = await apiClient.get<any>("/admin/configuration/logistica/settings");
    return r.data?.data ?? r.data;
  },

  updateLogistica: async (data: {
    linksFavoritos: Array<{ label: string; url: string }>;
    notasOperativas: string;
    flexCouriers?: string[];
    cutoffHours?: {
      colecta?: number | null;
      flex?: number | null;
      motos?: number | null;
      micros?: number | null;
    };
  }): Promise<{ success: boolean; message?: string; error?: string }> => {
    const r = await apiClient.put<any>("/admin/configuration/logistica/settings", data);
    return r.data;
  },

  // ============================================================
  // AI corrections (operator feedback loop)
  // ============================================================
  // Marcos pastes a customer scenario + the ideal reply, and from the
  // very next conversation Lucas treats it as a few-shot example —
  // no code change, no prompt edit, no restart. Closes the reactive
  // "rule-per-complaint" loop.

  listAiCorrections: async (): Promise<Array<{
    id: string;
    scenario: string;
    title: string | null;
    priority: number;
    turns: Array<{ role: 'user' | 'assistant'; content: string }>;
    createdAt: string;
  }>> => {
    // apiClient's response interceptor unwraps `{success, data}` to the
    // inner `data` when those are the only two keys, so r.data IS the
    // array directly. Falling back to r.data?.data preserves correctness
    // if the interceptor ever changes shape.
    const r = await apiClient.get<any>('/admin/configuration/ai/corrections');
    return Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
  },

  addAiCorrection: async (input: {
    customerContext: string;
    goodReply: string;
    badReply?: string;
    scenario?: string;
    title?: string;
  }): Promise<{ id: string; scenario: string; title: string }> => {
    const r = await apiClient.post<any>('/admin/configuration/ai/corrections', input);
    return r.data?.data ?? r.data;
  },

  deleteAiCorrection: async (id: string): Promise<void> => {
    await apiClient.delete<any>(`/admin/configuration/ai/corrections/${id}`);
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
// CAMPAIGNS API
// ============================================================================

export interface CampaignFilters {
  customerTypes: string[];
  funnelStages: string[];
  channel?: string | null;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: 'DRAFT' | 'SENDING' | 'COMPLETED' | 'FAILED';
  targetCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  completedAt: string | null;
}

export const campaignsApi = {
  /** Returns segment count + sample names without persisting anything. */
  preview: async (filters: CampaignFilters): Promise<{
    count: number;
    sample: Array<{ id: string; name: string | null; channel: string | null }>;
  }> => {
    const r = await apiClient.post<any>('/admin/campaigns/preview', filters);
    return r.data?.data ?? r.data;
  },

  list: async (): Promise<CampaignSummary[]> => {
    const r = await apiClient.get<any>('/admin/campaigns');
    return r.data?.data ?? r.data;
  },

  create: async (input: {
    name: string;
    messageTemplate: string;
    filters: CampaignFilters;
  }): Promise<{ campaignId: string; pending: number; skipped: number }> => {
    const r = await apiClient.post<any>('/admin/campaigns', input);
    return r.data?.data ?? r.data;
  },

  send: async (id: string): Promise<{ sent: number; failed: number; total: number }> => {
    const r = await apiClient.post<any>(`/admin/campaigns/${id}/send`);
    return r.data?.data ?? r.data;
  },

  /** Manual trigger for the dormant-customer reactivation pipeline.
   *  Runs the same logic the nightly cron drives. */
  runReactivation: async (): Promise<{
    considered: number;
    flagged: number;
    campaignId: string | null;
    campaignSent: number;
    campaignFailed: number;
  }> => {
    const r = await apiClient.post<any>('/admin/reactivation/run');
    return r.data?.data ?? r.data;
  },
};

// ============================================================================
// PRODUCTS API
// ============================================================================

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  baseUnit: string;
  basePriceArs: number | null;
  basePriceUsd: number | null;
  inStock: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  lastLowStockAlertAt: string | null;
  attributes: any;
  active: boolean;
  source: 'MANUAL' | 'TIENDANUBE' | 'IMPORT';
  externalId: string | null;
  lastSyncedAt: string | null;
  /** Short alias for the warehouse picker on the daily logistics
   *  Excel — Marcos 2026-06-06 (Bloque C). Auto-seeded on create with
   *  the first 40 chars of `name`; operator can override per product. */
  armadorAlias: string | null;
  createdAt: string;
  updatedAt: string;
}

export const productsApi = {
  list: async (opts?: { activeOnly?: boolean; category?: string; search?: string }): Promise<Product[]> => {
    const params = new URLSearchParams();
    if (opts?.activeOnly) params.set('activeOnly', 'true');
    if (opts?.category)   params.set('category', opts.category);
    if (opts?.search)     params.set('search', opts.search);
    const r = await apiClient.get<any>(`/admin/products?${params.toString()}`);
    return r.data?.data ?? r.data;
  },
  create: async (input: Partial<Product>): Promise<Product> => {
    const r = await apiClient.post<any>('/admin/products', input);
    return r.data?.data ?? r.data;
  },
  update: async (id: string, input: Partial<Product>): Promise<Product> => {
    const r = await apiClient.put<any>(`/admin/products/${id}`, input);
    return r.data?.data ?? r.data;
  },
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/products/${id}`);
  },
  importCsv: async (file: File): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const r = await apiClient.post<any>(
      '/admin/products/import',
      fd,
      { headers: { 'Content-Type': undefined as any } },
    );
    return r.data?.data ?? r.data;
  },
};

// ============================================================================
// QUOTES API
// ============================================================================

export interface QuoteItem {
  quantity: number;
  description: string;
  unitPrice: number;
  total: number;
}
export interface Quote {
  id: string;
  quoteNumber: string;
  contactId: string | null;
  leadId: string | null;
  buyerName: string;
  buyerAddress: string | null;
  buyerLocality: string | null;
  buyerTaxId: string | null;
  buyerTaxStatus: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  deliveryTerm: string | null;
  issueDate: string;
  expirationDate: string;
  currency: string;
  items: QuoteItem[];
  netAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface QuoteCreateInput {
  buyerName: string;
  buyerAddress?: string | null;
  buyerLocality?: string | null;
  buyerTaxId?: string | null;
  buyerTaxStatus?: string | null;
  paymentMethod?: string | null;
  paymentTerms?: string | null;
  deliveryTerm?: string | null;
  expirationDate?: string | null;
  currency?: string;
  taxRate?: number;
  items: Array<{ quantity: number; description: string; unitPrice: number }>;
  notes?: string | null;
  contactId?: string | null;
  leadId?: string | null;
}

export const quotesApi = {
  list: async (opts?: { leadId?: string; contactId?: string; status?: Quote['status'] }): Promise<Quote[]> => {
    const params = new URLSearchParams();
    if (opts?.leadId)    params.set('leadId',    opts.leadId);
    if (opts?.contactId) params.set('contactId', opts.contactId);
    if (opts?.status)    params.set('status',    opts.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const r = await apiClient.get<any>(`/admin/quotes${qs}`);
    return r.data?.data ?? r.data;
  },
  create: async (input: QuoteCreateInput): Promise<Quote> => {
    const r = await apiClient.post<any>('/admin/quotes', input);
    return r.data?.data ?? r.data;
  },
  setStatus: async (id: string, status: Quote['status']): Promise<Quote> => {
    const r = await apiClient.put<any>(`/admin/quotes/${id}/status`, { status });
    return r.data?.data ?? r.data;
  },
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/quotes/${id}`);
  },
  /** Fetches the rendered PDF as a Blob URL the browser can open in a tab. */
  getPdfBlobUrl: async (id: string): Promise<string> => {
    const r = await apiClient.get(`/admin/quotes/${id}/pdf`, { responseType: 'blob' });
    return URL.createObjectURL(r.data as Blob);
  },
};

// ============================================================================
// CLAUDE BUDGET API
// ============================================================================

export interface ClaudeBudgetStats {
  capUsd: number;
  hardStop: boolean;
  monthSpentUsd: number;
  monthCalls: number;
  todaySpentUsd: number;
  todayCalls: number;
  byCallSite: Array<{
    callSite: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  daily: Array<{ day: string; calls: number; costUsd: number }>;
  // Prompt-caching observability — Anthropic's cache_control breaks
  // input tokens into "create" (cache write, 1.25× input price) and
  // "read" (cache hit, 0.1× input price). `savedUsd` is the headline
  // dashboard number; the rest power the explanatory caption.
  cache?: {
    createTokens: number;
    readTokens: number;
    hitRatio: number;
    baselineUsd: number;
    actualUsd: number;
    savedUsd: number;
  };
  // Per-question cost — what one inbound customer message actually
  // costs us in Claude spend (averaged over the last N hours).
  // Marcos 2026-06-04: the "calls" number was being mis-read as user
  // questions; this surfaces the real cost so the dashboard matches
  // reality. `spendUsd` is REAL-customer only; `spendUsdTest` is
  // dev/test spend separately tracked.
  perQuestion?: {
    windowHours: number;
    questions: number;
    spendUsd: number;
    spendUsdTest?: number;
    costPerQuestionUsd: number;
  };
  // Month-level real-vs-test split so the operator sees what fraction
  // of the dashboard total is real customer spend vs internal
  // iteration cycle (E2E sweeps + sandbox probes).
  attribution?: {
    monthRealUsd: number;
    monthTestUsd: number;
    monthRealCalls: number;
    monthTestCalls: number;
  };
  // Marcos 2026-06-24: Bloque E cost-opts visibility. Cuántas veces
  // los shortcuts skip-Claude dispararon este mes + USD estimado
  // ahorrado por turnos que NUNCA llegaron a Claude.
  costOpts?: {
    bySource: Array<{ source: string; count: number; estimatedTokensSaved: number; estimatedUsdSaved: number }>;
    totalCount: number;
    totalTokensSaved: number;
    totalUsdSaved: number;
  };
}

export const aiBudgetApi = {
  getStats: async (): Promise<ClaudeBudgetStats> => {
    const r = await apiClient.get<any>('/admin/ai-budget/stats');
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-05: snapshot que compara ventana pre-opts vs ahora
   * para validar el Bloque E. Backend reads CLAUDE_OPTS_LIVE_SINCE_ISO
   * + CLAUDE_SAVINGS_WINDOW_DAYS de env.
   */
  getSavings: async (): Promise<AiSavingsSnapshot> => {
    const r = await apiClient.get<any>('/admin/ai-budget/savings');
    return r.data?.data ?? r.data;
  },
};

export interface AiSavingsWindow {
  fromIso: string;
  toIso: string;
  days: number;
  costUsd: number;
  calls: number;
  questions: number;
  costPerCallUsd: number;
  costPerQuestionUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AiSavingsSnapshot {
  optsLiveSince: string;
  baseline: AiSavingsWindow;
  current: AiSavingsWindow;
  delta: {
    costPctChange: number;
    callsPctChange: number;
    costPerQuestionPctChange: number;
  };
  byModelCurrent: Array<{ model: string; calls: number; costUsd: number; share: number }>;
  byCallSiteCurrent: Array<{ callSite: string; calls: number; costUsd: number; share: number }>;
}

// ============================================================================
// AUDIT API
// ============================================================================

export interface AuditEvent {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  action: string;
  ip: string | null;
  userAgent: string | null;
  metadata: any;
  createdAt: string;
}

// ============================================================================
// DAILY DIGEST API
// ============================================================================

export interface DigestPreview {
  text: string;
  delivered: boolean;
}
export const digestApi = {
  // The global apiClient response interceptor already strips the outer
  // {success, data} wrapper. The digest controller's payload has a
  // nested `data` key inside (the aggregate counters), so the usual
  // `r.data?.data ?? r.data` extractor would erase the sibling `text`.
  // Reading `r.data` directly returns {text, data, delivered}.
  preview: async (): Promise<DigestPreview> => {
    const r = await apiClient.get<any>('/admin/digest/preview');
    return r.data;
  },
  run: async (): Promise<{ delivered: boolean; recipient: string | null; reason?: string; text: string }> => {
    const r = await apiClient.post<any>('/admin/digest/run');
    return r.data;
  },
};

export interface SandboxMessage {
  id: string;
  sender: 'CUSTOMER' | 'AI' | 'BRENDA' | 'FRANCO' | 'ALDO' | 'ADMIN';
  content: string;
  timestamp: string;
}

export type SandboxChannel = 'WEBCHAT' | 'MERCADOLIBRE' | 'INSTAGRAM';

export const sandboxApi = {
  history: async (
    sessionId: string,
    channel: SandboxChannel = 'WEBCHAT',
  ): Promise<{ conversationId: string | null; channel: SandboxChannel; messages: SandboxMessage[] }> => {
    const r = await apiClient.get<any>(
      `/admin/sandbox/${encodeURIComponent(sessionId)}?channel=${channel}`,
    );
    return r.data?.data ?? r.data;
  },
  send: async (
    sessionId: string,
    text: string,
    channel: SandboxChannel = 'WEBCHAT',
    opts?: { mlItemId?: string },
  ): Promise<{
    conversationId: string;
    channel: SandboxChannel;
    agentReply: string | null;
    agentReplied: boolean;
    agentErrorReason: string | null;
    recent: SandboxMessage[];
  }> => {
    const body: any = { sessionId, text, channel };
    if (channel === 'MERCADOLIBRE' && opts?.mlItemId) body.mlItemId = opts.mlItemId;
    const r = await apiClient.post<any>('/admin/sandbox/message', body);
    return r.data?.data ?? r.data;
  },
  reset: async (
    sessionId: string,
    channel: SandboxChannel = 'WEBCHAT',
  ): Promise<{ closed: number; channel: SandboxChannel }> => {
    const r = await apiClient.post<any>(
      `/admin/sandbox/${encodeURIComponent(sessionId)}/reset?channel=${channel}`,
    );
    return r.data?.data ?? r.data;
  },
};

export const auditApi = {
  list: async (opts?: { actionPrefix?: string; userId?: string; limit?: number }): Promise<AuditEvent[]> => {
    const p = new URLSearchParams();
    if (opts?.actionPrefix) p.set('actionPrefix', opts.actionPrefix);
    if (opts?.userId)       p.set('userId', opts.userId);
    if (opts?.limit)        p.set('limit', String(opts.limit));
    const qs = p.toString() ? `?${p.toString()}` : '';
    const r = await apiClient.get<any>(`/admin/audit${qs}`);
    return r.data?.data ?? r.data;
  },
  actions: async (): Promise<string[]> => {
    const r = await apiClient.get<any>('/admin/audit/actions');
    return r.data?.data ?? r.data;
  },
};

export type IntegrationProviderName =
  | 'mercadolibre'
  | 'tiendanube'
  | 'meta'
  | 'claude'
  | 'dolarBlue'
  | 'whatsapp'
  | 'facebook'
  | 'instagram';

export interface IntegrationProvider {
  provider: IntegrationProviderName;
  kind: 'oauth' | 'env';
  status: 'connected' | 'unconfigured' | 'error';
  externalId: string | null;
  expiresAt: string | null;
  refreshable: boolean;
  installUrl: string | null;
  metadata?: Record<string, any>;
  productCount?: number;
  errorReason?: string;
}

export type ConversationSeverity =
  | 'NONE'
  | 'WRONG_PRICE'
  | 'IMPOSSIBLE_PROMISE'
  | 'BAD_TREATMENT'
  | 'OTHER';

export interface QualityImprovement {
  reason: string;
  originalSnippet: string;
  suggestedRewrite: string;
}

export interface QualityDailyPoint {
  date: string;
  avgScore: number | null;
  count: number;
}

export interface QualityMeResponse {
  windowDays: number;
  latest: {
    conversationId: string;
    score: number | null;
    strengths: string[];
    improvement: QualityImprovement | null;
    severeFlag: ConversationSeverity;
    severeReason: string | null;
    createdAt: string;
  } | null;
  avgScore: number | null;
  scoredCount: number;
  series: QualityDailyPoint[];
}

export interface QualityTeamResponse {
  windowDays: number;
  avgScore: number | null;
  scoredCount: number;
  series: QualityDailyPoint[];
  missedOpportunities: Array<{
    scoreId: string;
    conversationId: string;
    operator: string | null;
    reason: string | null;
    score: number | null;
    createdAt: string;
  }>;
  severeFlags: Array<{
    scoreId: string;
    conversationId: string;
    operator: string | null;
    severeFlag: ConversationSeverity;
    severeReason: string | null;
    createdAt: string;
  }>;
  patterns: Array<{
    key: string;
    reason: string;
    operatorCount: number;
    operatorIds: string[];
  }>;
}

export const qualityApi = {
  me: async (period = '7d'): Promise<QualityMeResponse> => {
    const r = await apiClient.get<any>(`/admin/quality/me?period=${encodeURIComponent(period)}`);
    return r.data?.data ?? r.data;
  },
  team: async (period = '7d'): Promise<QualityTeamResponse> => {
    const r = await apiClient.get<any>(`/admin/quality/team?period=${encodeURIComponent(period)}`);
    return r.data?.data ?? r.data;
  },
  rescore: async (conversationId: string): Promise<{ success: boolean; score: number | null; severeFlag: ConversationSeverity }> => {
    const r = await apiClient.post<any>(`/admin/quality/${conversationId}/rescore`, {});
    return r.data?.data ?? r.data;
  },
  applyCorrection: async (
    conversationId: string,
    overrideAssistantTurn?: string,
  ): Promise<{ success: boolean; exampleId?: string; scenario?: string; reason?: string }> => {
    const body: Record<string, unknown> = {};
    if (typeof overrideAssistantTurn === 'string' && overrideAssistantTurn.trim().length > 0) {
      body.overrideAssistantTurn = overrideAssistantTurn;
    }
    const r = await apiClient.post<any>(`/admin/quality/${conversationId}/apply-correction`, body);
    return r.data?.data ?? r.data;
  },
  /**
   * Per-turn correction. Marcos 2026-06-06: in a long conversation he
   * needs to correct any specific assistant turn (not just the last
   * one). Pass the AI message id + the corrected text; backend persists
   * a few-shot example keyed by that messageId so successive per-turn
   * corrections in the same conversation each land as their own row.
   */
  applyMessageCorrection: async (
    messageId: string,
    correctedText: string,
  ): Promise<{ success: boolean; exampleId?: string; scenario?: string; reason?: string; messageId: string }> => {
    const r = await apiClient.post<any>(`/admin/quality/message/${messageId}/apply-correction`, {
      correctedText,
    });
    return r.data?.data ?? r.data;
  },
  markReviewed: async (
    conversationId: string,
  ): Promise<{ success: boolean; reviewedAt?: string; reason?: string }> => {
    const r = await apiClient.post<any>(`/admin/quality/${conversationId}/mark-reviewed`, {});
    return r.data?.data ?? r.data;
  },
  unmarkReviewed: async (
    conversationId: string,
  ): Promise<{ success: boolean; reason?: string }> => {
    const r = await apiClient.delete<any>(`/admin/quality/${conversationId}/mark-reviewed`);
    return r.data?.data ?? r.data;
  },
  applyCorrectionsBulk: async (
    conversationIds: string[],
  ): Promise<{
    requested: number;
    applied: number;
    skipped: number;
    results: Array<{
      conversationId: string;
      success: boolean;
      exampleId?: string;
      scenario?: string;
      reason?: string;
    }>;
  }> => {
    const r = await apiClient.post<any>(`/admin/quality/apply-corrections-bulk`, { conversationIds });
    return r.data?.data ?? r.data;
  },
};

export interface MayoristaConfigResponse {
  keywords: string[];
  volumeThresholdLitres: number;
  source: 'db' | 'env-default' | 'fallback';
  defaults: { keywords: string[]; volumeThresholdLitres: number };
}

export interface MayoristaProbeResult {
  isMayorista: boolean;
  signals: string[];
  confidence: number;
}

export const leadDetectionApi = {
  getMayorista: async (): Promise<MayoristaConfigResponse> => {
    const r = await apiClient.get<any>('/admin/lead-detection/mayorista');
    return r.data?.data ?? r.data;
  },
  saveMayorista: async (input: { keywords?: string[]; volumeThresholdLitres?: number }): Promise<{ keywords: string[]; volumeThresholdLitres: number }> => {
    const r = await apiClient.put<any>('/admin/lead-detection/mayorista', input);
    return r.data?.data ?? r.data;
  },
  probeMayorista: async (text: string): Promise<MayoristaProbeResult> => {
    const r = await apiClient.post<any>('/admin/lead-detection/mayorista/probe', { text });
    return r.data?.data ?? r.data;
  },
};

export interface IntegrationTestResult {
  success: boolean;
  latencyMs: number;
  detail?: string;
  reason?: string;
}

export interface LaminadoProductRow {
  key: string;
  ancho: number;
  espesor: string;
  tipo: 'Liso' | 'Reforzado';
  usdPorMetroLineal: number | null;
}

export interface LaminadoDiscountTier {
  tier: string;
  m2Min: number;
  pct: number;
}

export interface LaminadoPegamentoRow {
  kg: number;
  rindeM2: number;
}

export interface LaminadosPricelistResponse {
  products: LaminadoProductRow[];
  discountTiers: LaminadoDiscountTier[];
  pegamentoPresentaciones: LaminadoPegamentoRow[];
  pegamentoM2PerKg: number;
  iva: number;
  fallbackArsPorUsd: number;
  updatedAt?: string;
  updatedBy?: string;
  defaults: Omit<LaminadosPricelistResponse, 'defaults'>;
}

export interface MlQaRow {
  conversationId: string;
  buyer: { name: string | null; mlUserId: string | null };
  question: { id: string; text: string; at: string };
  reply: { id: string; text: string; at: string; bySender: 'AI' | 'ADMIN' | 'OTHER' } | null;
  responseTimeMs: number | null;
  publication: {
    itemId: string | null;
    title: string | null;
    permalink: string | null;
    thumbnail: string | null;
  };
  quality: {
    score: number | null;
    severeFlag: string;
    severeReason: string | null;
    /** When set, the row was already reviewed and is hidden from Marcadas. */
    reviewedAt: string | null;
  };
}

export interface MlQaCounts {
  all: number;
  flagged: number;
  scoreLe7: number;
  scoreLe5: number;
}

export const mercadolibreApi = {
  qaCounts: async (): Promise<MlQaCounts> => {
    const r = await apiClient.get<any>('/admin/mercadolibre/qa/counts');
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-18 PM: typeahead "#" del compositor del panel de
   * QA. Búsqueda en TIEMPO REAL sobre publicaciones ACTIVAS de ML (no
   * sobre el catálogo TN — pegar links de TiendaNube en una respuesta
   * de ML es falta grave de plataforma).
   */
  searchListings: async (q: string, limit = 8): Promise<Array<{
    itemId: string;
    title: string;
    permalink: string;
    thumbnailUrl: string | null;
    accountKey: string;
  }>> => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    const r = await apiClient.get<any>(`/admin/mercadolibre/listings/search?${qs.toString()}`);
    return r.data?.data ?? r.data ?? [];
  },
  listQa: async (params?: {
    limit?: number;
    since?: string;
    flagged?: boolean;
    maxScore?: number;
    search?: string;
  }): Promise<MlQaRow[]> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.since) qs.set('since', params.since);
    if (params?.flagged) qs.set('flagged', '1');
    if (params?.maxScore != null) qs.set('maxScore', String(params.maxScore));
    if (params?.search && params.search.trim().length > 0) qs.set('search', params.search.trim());
    const url = `/admin/mercadolibre/qa${qs.toString() ? `?${qs.toString()}` : ''}`;
    const r = await apiClient.get<any>(url);
    return r.data?.data ?? r.data ?? [];
  },
  /**
   * Marcos 2026-06-11: review-mode pending drafts (when
   * ML_QA_REVIEW_MODE=true on the backend, AI answers stay as drafts
   * until the operator releases them).
   */
  openClaims: async (limit?: number): Promise<Array<{
    conversationId: string;
    messageId: string;
    contactId: string;
    contactName: string | null;
    content: string;
    mlAccountKey: string | null;
    mlResourceId: string | null;
    createdAt: string;
    messageCount: number;
    /** Marcos 2026-06-22: 'seller' (nosotros), 'buyer' (comprador),
     *  'ml' (mediación), null (no determinado). El panel segmenta. */
    pendingFor: 'seller' | 'buyer' | 'ml' | null;
  }>> => {
    const url = `/admin/mercadolibre/qa/open-claims${limit ? `?limit=${limit}` : ''}`;
    const r = await apiClient.get<any>(url);
    return r.data?.data ?? r.data ?? [];
  },
  resolveClaim: async (conversationId: string): Promise<void> => {
    await apiClient.post<any>(`/admin/mercadolibre/qa/claim/${encodeURIComponent(conversationId)}/resolve`);
  },
  pendingDrafts: async (limit?: number): Promise<Array<{
    messageId: string;
    conversationId: string;
    contactName: string | null;
    contactId: string;
    mlQuestionId: string | null;
    mlPackId: string | null;
    mlAccountKey: string | null;
    // Marcos 2026-06-17: draft source — splits the QA panel into
    // Preguntas (kind='question') and Mensajes (kind='message').
    kind: 'question' | 'message';
    content: string;
    createdAt: string;
    // Marcos 2026-06-12: publication + question surfaced so the
    // operator can validate the AI draft without leaving the panel.
    questionText: string | null;
    itemId: string | null;
    itemTitle: string | null;
    itemPermalink: string | null;
    /** Marcos 2026-06-26: thumbnail de la publicación que viene de la
     *  API de ML — el panel QA lo muestra al lado del MLA para que el
     *  operador valide visualmente sin abrir el link. */
    itemThumbnailUrl: string | null;
    /** Marcos 2026-06-25: self-eval score (0..10) cuando el draft vino
     *  del modo cerrado. null si vino del pipeline regular. */
    constrainedSelfEvalScore: number | null;
  }>> => {
    const url = `/admin/mercadolibre/qa/pending-drafts${limit ? `?limit=${limit}` : ''}`;
    const r = await apiClient.get<any>(url);
    return r.data?.data ?? r.data ?? [];
  },
  releaseDraft: async (messageId: string, text?: string): Promise<{
    messageId: string;
    mlQuestionId: string;
    sentBy: string | null;
  }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/qa/release/${encodeURIComponent(messageId)}`,
      text != null ? { text } : {},
    );
    return r.data?.data ?? r.data;
  },
  discardDraft: async (messageId: string): Promise<{ messageId: string }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/qa/discard/${encodeURIComponent(messageId)}`,
      {},
    );
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-25: el operador escribe una respuesta corta y
   * Claude la mejora — saludo, info complementaria desde ficha + Q&A
   * curadas, tono natural. Devuelve solo el texto mejorado; el
   * operador decide si lo acepta antes de "Enviar".
   */
  improveDraft: async (messageId: string, text: string): Promise<{ messageId: string; improved: string }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/qa/improve-draft/${encodeURIComponent(messageId)}`,
      { text },
    );
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-24: re-correr el agente sobre la misma pregunta
   * que originó el draft, con el prompt actual. Devuelve el nuevo
   * texto generado para que el frontend lo muestre sin recargar.
   */
  regenerateDraft: async (messageId: string): Promise<{ messageId: string; content: string }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/qa/regenerate/${encodeURIComponent(messageId)}`,
      {},
    );
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-12: persist mid-edit changes to a pending draft.
   * The QA panel debounces typing into this endpoint so leaving and
   * returning to the page preserves the edit.
   */
  updateDraftText: async (messageId: string, text: string): Promise<{ messageId: string }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/qa/draft/${encodeURIComponent(messageId)}`,
      { text },
    );
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-12: bulk-discard. olderThanHours=0 means "every
   * pending draft regardless of age".
   */
  bulkDiscardDrafts: async (olderThanHours: number): Promise<{ discarded: number; olderThanHours: number }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/qa/discard-bulk?olderThanHours=${encodeURIComponent(String(olderThanHours))}`,
      {},
    );
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-12: runtime AI-auto-reply toggle. When enabled,
   * the webhook flow sends AI replies straight to ML; when
   * disabled (default), replies stay as drafts for review.
   */
  getAiMode: async (): Promise<{ autoReplyEnabled: boolean }> => {
    const r = await apiClient.get<any>('/admin/mercadolibre/qa/ai-mode');
    return r.data?.data ?? r.data;
  },
  setAiMode: async (enabled: boolean): Promise<{ autoReplyEnabled: boolean }> => {
    const r = await apiClient.post<any>('/admin/mercadolibre/qa/ai-mode', { enabled });
    return r.data?.data ?? r.data;
  },
};

// Bloque E item 3 — Marcos 2026-06-06: per-publication FAQ. Operator
// authors a keyword set + canned answer for an ML item; the inbound
// handler returns the answer instantly (no Claude call) when all
// keywords appear in the buyer's question.
export interface PublicationFaq {
  id: string;
  itemId: string;
  keywords: string[];
  answer: string;
  active: boolean;
  hitCount: number;
  lastHitAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export const publicationFaqsApi = {
  list: async (params?: { itemId?: string; activeOnly?: boolean }): Promise<PublicationFaq[]> => {
    const qs = new URLSearchParams();
    if (params?.itemId) qs.set('itemId', params.itemId);
    if (params?.activeOnly) qs.set('activeOnly', '1');
    const url = `/admin/publication-faqs${qs.toString() ? `?${qs.toString()}` : ''}`;
    const r = await apiClient.get<any>(url);
    return r.data?.data ?? r.data ?? [];
  },
  create: async (input: {
    itemId: string;
    keywords: string[];
    answer: string;
    active?: boolean;
  }): Promise<PublicationFaq> => {
    const r = await apiClient.post<any>('/admin/publication-faqs', input);
    return r.data?.data ?? r.data;
  },
  update: async (id: string, input: Partial<{
    itemId: string;
    keywords: string[];
    answer: string;
    active: boolean;
  }>): Promise<PublicationFaq> => {
    const r = await apiClient.put<any>(`/admin/publication-faqs/${id}`, input);
    return r.data?.data ?? r.data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete<any>(`/admin/publication-faqs/${id}`);
  },
  suggestKeywords: async (text: string): Promise<string[]> => {
    const r = await apiClient.post<any>('/admin/publication-faqs/suggest-keywords', { text });
    return r.data?.data ?? r.data ?? [];
  },
};

export const laminadosApi = {
  getPricelist: async (): Promise<LaminadosPricelistResponse> => {
    const r = await apiClient.get<any>('/admin/laminados/pricelist');
    return r.data?.data ?? r.data;
  },
  uploadPricelist: async (file: File): Promise<LaminadosPricelistResponse> => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const r = await apiClient.post<any>(
      '/admin/laminados/upload-pricelist',
      fd,
      { headers: { 'Content-Type': undefined as any } },
    );
    return r.data?.data ?? r.data;
  },
  reset: async (): Promise<LaminadosPricelistResponse> => {
    const r = await apiClient.post<any>('/admin/laminados/reset', {});
    return r.data?.data ?? r.data;
  },
};

export const integrationsApi = {
  list: async (): Promise<IntegrationProvider[]> => {
    const r = await apiClient.get<any>('/admin/integrations');
    return r.data?.data ?? r.data;
  },
  disconnect: async (provider: IntegrationProviderName): Promise<{ deleted: boolean }> => {
    const r = await apiClient.delete<any>(`/admin/integrations/${provider}`);
    return r.data?.data ?? r.data;
  },
  syncTiendaNube: async (): Promise<any> => {
    const r = await apiClient.post<any>('/admin/tiendanube/sync', {});
    return r.data?.data ?? r.data;
  },
  test: async (provider: IntegrationProviderName): Promise<IntegrationTestResult> => {
    const r = await apiClient.post<any>(`/admin/integrations/${provider}/test`, {});
    return r.data?.data ?? r.data;
  },
};

// ============================================================================
// EXPORT ALL API MODULES
// ============================================================================

// Bloque C — Marcos 2026-06-06: Placas PRFV lifecycle. Pinned at the
// top of the daily Excel; the operator manages each row's state
// (PENDIENTE → LISTA_CORTADA → DESPACHADA_RETIRADA) from a dedicated
// page so the file always reflects current reality.
export type PrfvPlacaState = 'PENDIENTE' | 'LISTA_CORTADA' | 'DESPACHADA_RETIRADA';

export interface PrfvPlaca {
  id: string;
  cliente: string;
  producto: string;
  state: PrfvPlacaState;
  notes: string | null;
  stateChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

// Bloque C — Marcos 2026-06-06: Daily Logística aggregator + xlsx
// download + per-row armado state.
export interface DailySectionRowItem {
  sku: string | null;
  name: string;
  quantity: number;
  alias: string | null;
  imageUrl: string | null;
  unitPrice: number | null;
  /** Marcos 2026-06-10: warehouse location (Product.warehouseLocation
   *  joined by SKU). Frontend renders "UBI: {warehouseLocation}"
   *  on the item line so the armador knows where to grab the box
   *  in the galpón. Null when no SKU or no location uploaded. */
  warehouseLocation: string | null;
}
export interface DailySectionRow {
  cliente: string;
  /** Marcos 2026-06-10: split fields for the two-line panel layout
   *  (name on top, order ref underneath). `cliente` stays composite
   *  for the Excel generator + legacy probes. */
  clienteName: string;
  orderRef: string;
  producto: string;
  rowKey: string;
  source: 'ML_CUENTA_1' | 'ML_CUENTA_2' | 'CRM_ORDER' | 'TIENDANUBE_ORDER' | 'PRFV_PLACA';
  sourceId: string;
  armado: boolean;
  armadoAt: string | null;
  armadoById: string | null;
  /** Marcos 2026-06-25: nombre resuelto del armador (User.name /
   *  username / email). Aparece bajo las fechas A:/L: en el panel. */
  armadoByName: string | null;
  /** Bloque B item 3.6 — Marcos 2026-06-08: 3-state lifecycle. */
  state: 'PENDIENTE' | 'ARMADO' | 'LISTO';
  /** ISO timestamp of the LISTO transition (null while state≠LISTO). */
  listoAt: string | null;
  /** Bloque B item 3.7 — Marcos 2026-06-08: per-item check progress.
   *  Array of item keys (SKU when present, else `idx:N`) the picker
   *  has ticked off inside the expanded panel. */
  itemsChecked: string[];
  /** Bloque B item 3.8 — Marcos 2026-06-08: per-row free-text note del armador. */
  notes: string | null;
  /**
   * Marcos 2026-06-18 PM: nota cargada por el operador en /orders
   * (o que vino del sync de TN). Read-only para el armador — su
   * propia aclaración va en `notes`.
   */
  orderNotes: string | null;
  /** Bloque B item 3.9 — cancellation flag (red CANCELADA badge). */
  isCancelled: boolean;
  /** Bloque B item 3.9 — ML publication URL (ML rows only; null for CRM/TN). */
  mlPermalink: string | null;
  /** Bloque B item 3.11 — dispatched flag. Hidden from the default
   *  Pendientes tab; visible under the DESPACHADAS tab. */
  isDispatched: boolean;
  /**
   * Marcos 2026-06-20: true cuando la fila terminó como despachada
   * porque ML reportó shipped/in_hub/in_transit, PERO nadie del
   * equipo stampó armado en el panel (state === PENDIENTE). Señal
   * de que el paquete físicamente se fue sin verificación. La UI
   * lo surfacea con un badge rojo en la tab Despachadas.
   */
  autoDispatchedWithoutArmado: boolean;
  /** Marcos 2026-06-11 (#2000016880649372): ML pack parked in
   *  `substatus=in_hub` past ML_HUB_STALE_HOURS — the carrier never
   *  picked up. The backend forces `isDispatched=false` so the row
   *  reappears in Pendientes; the UI shows a red ATASCADO EN HUB
   *  badge so the picker escalates instead of re-picking. */
  isStuckInHub: boolean;
  /** Raw ML shipping signals — diagnostic only; the panel may
   *  surface them in a tooltip when the operator hovers a row. */
  mlShippingStatus: string | null;
  mlShippingSubstatus: string | null;
  /** Marcos 2026-06-09: "Acordás la entrega" — ML order without
   *  shipping integration, routed to MOTOS section. Picker must
   *  coordinate with the buyer; UI renders an "Acordá con cliente"
   *  chip on the row. */
  pickupAgreement: boolean;
  /** Marcos 2026-06-10: post-venta unread flag (ML rows only;
   *  null on CRM/TN). When true, render a MENSAJE envelope chip
   *  so the picker reads the post-venta thread before sealing. */
  hasUnreadMessage: boolean | null;
  /** Marcos 2026-06-10: flex courier stamp (FLEX rows only). Shown
   *  as a dropdown in the "Listas para despachar" tab and as a
   *  small badge once selected so the trace persists. */
  flexCourier: string | null;
  /** ISO created-at; drives the per-section sort (newest first). */
  createdAtIso: string | null;
  /** Bloque B item 2 — Marcos 2026-06-07 PM: itemised breakdown for
   *  the expand-in-place panel on the logística diaria page. Each
   *  row shows the short "X + Y - Z" formula collapsed, and the
   *  picker can open it to see per-item SKU + qty + price + alias. */
  items: DailySectionRowItem[];
}
export type DailySection =
  | 'COLECTA_1'
  | 'COLECTA_2'
  | 'FLEX_1'
  | 'FLEX_2'
  | 'MOTOS'
  | 'MICROS'
  | 'RETIRA_CASEROS'
  | 'LAMINADOS_PRFV';
export interface AggregatedDay {
  date: string;
  sections: Record<DailySection, DailySectionRow[]>;
  errors: Array<{ source: string; message: string }>;
  notes: Array<{ source: string; message: string }>;
}

export const dailyLogisticaApi = {
  aggregate: async (date?: string): Promise<AggregatedDay> => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    // Marcos 2026-06-27: el aggregator del panel agrega ML + TN + PRFV
    // con calls a ML que pueden tardar (~30s observados). El timeout
    // default del apiClient es 30s, que se cumplía justo cuando el
    // backend recién estaba devolviendo → operador veía "Error de red"
    // a pesar de que el servidor SÍ estaba respondiendo. 60s da margen
    // suficiente sin que el operador tenga que reintentar manualmente.
    const r = await apiClient.get<any>(
      `/admin/daily-logistica?${params.toString()}`,
      { timeout: 60_000 },
    );
    return r.data?.data ?? r.data;
  },
  markArmado: async (rowKey: string, dayDate: string): Promise<void> => {
    await apiClient.post('/admin/daily-logistica/armado', { rowKey, dayDate });
  },
  unmarkArmado: async (rowKey: string): Promise<void> => {
    await apiClient.delete(`/admin/daily-logistica/armado/${encodeURIComponent(rowKey)}`);
  },
  /**
   * Bloque B item 3.6 — Marcos 2026-06-08: 3-state advance.
   * Forward-only PENDIENTE → ARMADO → LISTO click handler used by the
   * row-level state pill on the daily logística panel.
   */
  advanceState: async (rowKey: string, dayDate: string): Promise<{
    rowKey: string; state: 'ARMADO' | 'LISTO';
    armadoAt: string | null; listoAt: string | null;
  }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/advance', { rowKey, dayDate });
    return r.data?.data ?? r.data;
  },
  /**
   * Bulk set N rows to ARMADO or LISTO in one call. Drives the
   * multi-select action bar — operator ticks several rows and
   * marks them all with one click.
   */
  bulkSetState: async (
    rowKeys: string[],
    dayDate: string,
    targetState: 'ARMADO' | 'LISTO',
  ): Promise<{ created: number; updated: number; failed: string[] }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/bulk-state', {
      rowKeys, dayDate, targetState,
    });
    return r.data?.data ?? r.data;
  },
  /**
   * Bloque B item 3.8 — set the per-row free-text note. Empty / null
   * clears it. Backend caps at 500 chars.
   */
  setNote: async (rowKey: string, dayDate: string, note: string | null): Promise<void> => {
    await apiClient.post('/admin/daily-logistica/note', { rowKey, dayDate, note });
  },
  /**
   * Marcos 2026-06-10: list the allowed FLEX courier names. DB-first
   * (LogisticaConfiguration.flexCouriers) with env fallback. Drives
   * the dropdown in the "Listas para despachar" tab.
   */
  listFlexCouriers: async (): Promise<string[]> => {
    const r = await apiClient.get<any>('/admin/daily-logistica/flex-couriers');
    return r.data?.data?.couriers ?? r.data?.couriers ?? [];
  },
  /**
   * Marcos 2026-06-10: persist the flex courier list. Admin-only.
   * 1-10 names, each trimmed. Surfaced from the Settings → Logística
   * tab so Marcos can rename / replace courier services without a
   * redeploy.
   */
  updateFlexCouriers: async (couriers: string[]): Promise<{ couriers: string[] }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/flex-couriers', { couriers });
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-10: upload a 2-col sheet (SKU + ubicación). The
   * backend joins it onto Product.warehouseLocation; the daily
   * panel renders "UBI: …" on every item line that has a match.
   */
  uploadWarehouseLocations: async (file: File): Promise<{
    parsedRows: number;
    matched: number;
    updated: number;
    cleared: number;
    unmatchedSkus: string[];
  }> => {
    const form = new FormData();
    form.append('file', file);
    const r = await apiClient.post<any>('/admin/products/upload-locations', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data?.data ?? r.data;
  },

  /**
   * Marcos 2026-06-20: upload del mapping CP -> zona del courier.
   * El panel de despachos lo usa como ultimo fallback en la cadena
   * de derivacion de zona cuando el label de TN no trae zona
   * embebida.
   */
  uploadPostalCodeZones: async (file: File): Promise<{
    parsedRows: number;
    expandedRows: number;
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    invalidSamples: Array<{ rowIndex: number; reason: string }>;
  }> => {
    const form = new FormData();
    form.append('file', file);
    const r = await apiClient.post<any>('/admin/postal-code-zones/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data?.data ?? r.data;
  },
  listPostalCodeZones: async (opts?: { activeOnly?: boolean; limit?: number }): Promise<Array<{
    id: string;
    cp: string;
    locality: string;
    localityNormalized: string;
    zone: string;
    province: string | null;
    active: boolean;
  }>> => {
    const qs = new URLSearchParams();
    if (opts?.activeOnly) qs.set('activeOnly', 'true');
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const r = await apiClient.get<any>(`/admin/postal-code-zones?${qs.toString()}`);
    return r.data?.data ?? r.data ?? [];
  },
  postalCodeZoneStats: async (): Promise<{
    total: number;
    byZone: Array<{ zone: string; count: number }>;
  }> => {
    const r = await apiClient.get<any>('/admin/postal-code-zones/stats');
    return r.data?.data ?? r.data;
  },
  resolvePostalCodeZone: async (input: { locality?: string; cp?: string }): Promise<{
    zone: string | null;
    locality: string | null;
    source: 'locality_exact' | 'locality_normalized' | 'cp' | 'default' | 'none';
  }> => {
    const qs = new URLSearchParams();
    if (input.locality) qs.set('locality', input.locality);
    if (input.cp) qs.set('cp', input.cp);
    const r = await apiClient.get<any>(`/admin/postal-code-zones/resolve?${qs.toString()}`);
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-10: stamp the flex courier on one or many rows.
   * `courier=null` clears the field.
   */
  setFlexCourier: async (
    rowKeys: string[],
    dayDate: string,
    courier: string | null,
  ): Promise<{ updated: number; failed: string[] }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/flex-courier', {
      rowKeys, dayDate, courier,
    });
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-10: archive cancelled rows so they leave the
   * panel and land in the cancelled-orders module.
   */
  archiveCancelled: async (
    rowKeys: string[],
    dayDate: string,
  ): Promise<{ archived: number; failed: string[] }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/archive-cancelled', {
      rowKeys, dayDate,
    });
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-10: stamp a row as manually dispatched. Sends
   * `dispatched=false` to clear the manual flag (row goes back to
   * source-side dispatch state).
   */
  setManualDispatch: async (
    rowKeys: string[],
    dayDate: string,
    dispatched: boolean,
  ): Promise<{ updated: number; failed: string[] }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/manual-dispatch', {
      rowKeys, dayDate, dispatched,
    });
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-10: move rows to a different section via manual
   * override. Used for "Mover a Retira Caseros" on ML no_shipping
   * rows where the API can't distinguish entrega vs envío. section
   * = null clears the override and lets the row drop back to the
   * computed section.
   */
  setSectionOverride: async (
    rowKeys: string[],
    dayDate: string,
    section: string | null,
  ): Promise<{ updated: number; failed: string[] }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/section-override', {
      rowKeys, dayDate, section,
    });
    return r.data?.data ?? r.data;
  },
  /**
   * Bloque B item 3.7 — toggle a single item's check inside the
   * expanded row panel. The frontend passes the total items count
   * (itemsExpected) so the backend can guard the LISTO transition.
   */
  toggleItemCheck: async (
    rowKey: string,
    dayDate: string,
    itemKey: string,
    checked: boolean,
    itemsExpected: number,
  ): Promise<{ itemsChecked: string[]; itemsExpected: number; state: string }> => {
    const r = await apiClient.post<any>('/admin/daily-logistica/item-check', {
      rowKey, dayDate, itemKey, checked, itemsExpected,
    });
    return r.data?.data ?? r.data;
  },
  /**
   * Download the day's xlsx — returns the raw blob so the caller can
   * trigger a browser save-as. Defaults to today (server time) when
   * `date` is omitted.
   */
  downloadExcel: async (date?: string): Promise<{ blob: Blob; filename: string }> => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const r = await apiClient.get(`/admin/daily-logistica/excel?${params.toString()}`, {
      responseType: 'blob',
    });
    // Pull the filename from Content-Disposition when present;
    // fall back to a sane default so the download never breaks.
    const cd = (r.headers?.['content-disposition'] ?? '') as string;
    const m = /filename="?([^"]+)"?/i.exec(cd);
    const filename = m?.[1] ?? `Envios- ${date ?? 'hoy'}.xlsx`;
    return { blob: r.data as Blob, filename };
  },
};

export const prfvPlacasApi = {
  list: async (opts?: { state?: PrfvPlacaState; search?: string }): Promise<PrfvPlaca[]> => {
    const params = new URLSearchParams();
    if (opts?.state) params.set('state', opts.state);
    if (opts?.search) params.set('search', opts.search);
    const r = await apiClient.get<any>(`/admin/prfv-placas?${params.toString()}`);
    return r.data?.data ?? r.data;
  },
  counts: async (): Promise<Record<PrfvPlacaState, number>> => {
    const r = await apiClient.get<any>('/admin/prfv-placas/counts');
    return r.data?.data ?? r.data;
  },
  create: async (input: { cliente: string; producto: string; state?: PrfvPlacaState; notes?: string | null }): Promise<PrfvPlaca> => {
    const r = await apiClient.post<any>('/admin/prfv-placas', input);
    return r.data?.data ?? r.data;
  },
  update: async (id: string, input: Partial<{ cliente: string; producto: string; state: PrfvPlacaState; notes: string | null }>): Promise<PrfvPlaca> => {
    const r = await apiClient.put<any>(`/admin/prfv-placas/${id}`, input);
    return r.data?.data ?? r.data;
  },
  advance: async (id: string): Promise<PrfvPlaca> => {
    const r = await apiClient.post<any>(`/admin/prfv-placas/${id}/advance`);
    return r.data?.data ?? r.data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/prfv-placas/${id}`);
  },
};

/**
 * Bloque A item 3 — Marcos 2026-06-12: ML competitor watch-list UI.
 * Lists/adds/removes watched competitor ML item IDs per product, and
 * the backend hydrates each watch with the live price/stock/sold
 * pulled from `/items/{id}`. Admin + Ventas only.
 */
// Backend returns the watch row's primary key as `watchId` on
// list rows (legacy field name), and as `id` on the POST `add`
// response. Mirror that shape with a flexible interface so callers
// can pull either via `competitorRowId`.
export interface CompetitorWatch {
  /** Row primary key. Backend POST returns `id`; backend GET row
   *  returns `watchId`. We accept either to keep both paths working
   *  without forcing a backend rename. */
  id?: string;
  watchId?: string;
  itemId: string;
  label: string | null;
  /** Live-hydrated fields surfaced by the backend's `/items/{id}`
   *  fetch. Present on GET responses, absent on POST. */
  title?: string | null;
  price?: number | null;
  currencyId?: string | null;
  soldQuantity?: number | null;
  availableQuantity?: number | null;
  status?: string | null;
  permalink?: string | null;
  sellerNickname?: string | null;
  error?: string | null;
  createdAt?: string;
}
export interface CompetitorList {
  productId: string;
  productSku: string | null;
  productName: string;
  productPriceArs: number | null;
  ourStock: number | null;
  watches: CompetitorWatch[];
}
/** Pick the row's primary key regardless of which field the backend
 *  used for it. */
export function competitorRowId(w: CompetitorWatch): string {
  return (w.watchId ?? w.id ?? '') as string;
}
export interface DispatchTariff {
  id: string;
  carrier: string;
  zone: string;
  costPerPackage: number;
  currency: string;
  active: boolean;
  notes: string | null;
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export const dispatchTariffsApi = {
  list: async (): Promise<DispatchTariff[]> => {
    const r = await apiClient.get<any>('/admin/dispatch-tariffs');
    return r.data?.data ?? r.data ?? [];
  },
  create: async (input: { carrier: string; zone: string; costPerPackage: number; currency?: string; notes?: string | null; active?: boolean }): Promise<DispatchTariff> => {
    const r = await apiClient.post<any>('/admin/dispatch-tariffs', input);
    return r.data?.data ?? r.data;
  },
  update: async (id: string, patch: Partial<{ carrier: string; zone: string; costPerPackage: number; currency: string; notes: string | null; active: boolean }>): Promise<DispatchTariff> => {
    const r = await apiClient.put<any>(`/admin/dispatch-tariffs/${id}`, patch);
    return r.data?.data ?? r.data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/dispatch-tariffs/${id}`);
  },
};

// Marcos 2026-06-22: catálogo de responsables operativos (personal
// de depósito) editable desde ADMIN. Lo consume el form de pedidos
// en el tab REPOSICIÓN y la card de costos por responsable en
// /analytics.
export type OperationalResponsible = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const operationalResponsiblesApi = {
  list: async (opts?: { activeOnly?: boolean }): Promise<OperationalResponsible[]> => {
    const url = opts?.activeOnly
      ? '/admin/operational-responsibles?active=1'
      : '/admin/operational-responsibles';
    const r = await apiClient.get<any>(url);
    return r.data?.data ?? r.data ?? [];
  },
  create: async (input: { name: string; active?: boolean }): Promise<OperationalResponsible> => {
    const r = await apiClient.post<any>('/admin/operational-responsibles', input);
    return r.data?.data ?? r.data;
  },
  update: async (id: string, patch: Partial<{ name: string; active: boolean }>): Promise<OperationalResponsible> => {
    const r = await apiClient.put<any>(`/admin/operational-responsibles/${id}`, patch);
    return r.data?.data ?? r.data;
  },
  archive: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/operational-responsibles/${id}`);
  },
};

// Marcos 2026-06-24: base de conocimiento por publicación (Phase A
// de la arquitectura de "respuestas reales por publicación"). Ingiere
// el histórico de Q&A desde la API de Mercado Libre y permite al
// operador curar fila por fila. El modo de respuesta cerrado (Phase C)
// va a leer SOLO de acá + la ficha de la publicación.
export type MlKnowledgeRow = {
  id: string;
  mlQuestionId: string;
  questionText: string;
  answerText: string | null;
  curatedAnswer: string | null;
  questionAt: string;
  answeredAt: string | null;
  curationStatus: 'pending' | 'kept' | 'edited' | 'discarded' | string;
  stalenessFlag: string | null;
  aiValidityScore: number | null;
  aiNote: string | null;
  curatedAt: string | null;
};
export type MlKnowledgeSummaryRow = {
  itemId: string;
  accountKey: string;
  total: number;
  pending: number;
  kept: number;
  edited: number;
  discarded: number;
  /** Marcos 2026-06-25: override del modo cerrado por publicación. */
  closedModeMode: 'auto' | 'always-draft' | 'always-send';
  /** True cuando hay >= 3 (env) curadas → el modo cerrado se activa solo. */
  closedModeReady: boolean;
};
export const mlPublicationKnowledgeApi = {
  ingest: async (itemId: string, accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2'): Promise<{
    itemId: string;
    accountKey: string;
    fetched: number;
    inserted: number;
    skipped: number;
    errored: number;
    note?: string;
  }> => {
    const qs = accountKey ? `?accountKey=${accountKey}` : '';
    const r = await apiClient.post<any>(`/admin/mercadolibre/publications/${encodeURIComponent(itemId)}/ingest${qs}`, {});
    return r.data?.data ?? r.data;
  },
  listForItem: async (itemId: string): Promise<MlKnowledgeRow[]> => {
    const r = await apiClient.get<any>(`/admin/mercadolibre/publications/${encodeURIComponent(itemId)}/knowledge`);
    return r.data?.data ?? r.data ?? [];
  },
  summary: async (): Promise<MlKnowledgeSummaryRow[]> => {
    const r = await apiClient.get<any>(`/admin/mercadolibre/publications/knowledge/summary`);
    return r.data?.data ?? r.data ?? [];
  },
  curate: async (rowId: string, body: { action: 'keep' | 'edit' | 'discard'; curatedAnswer?: string; stalenessFlag?: string }): Promise<void> => {
    await apiClient.put<any>(`/admin/mercadolibre/publications/knowledge/${encodeURIComponent(rowId)}`, body);
  },
  /**
   * Marcos 2026-06-24 (Phase B): corre la pasada de IA sobre las
   * Q&A pendientes — popula aiValidityScore + aiNote para que el
   * operador vea cuáles son dudosas.
   */
  aiStalenessPass: async (itemId: string, limit?: number): Promise<{
    itemId: string;
    processed: number;
    skipped: number;
    errored: number;
    flagged: number;
    note?: string;
  }> => {
    const qs = limit ? `?limit=${limit}` : '';
    const r = await apiClient.post<any>(`/admin/mercadolibre/publications/${encodeURIComponent(itemId)}/ai-staleness-pass${qs}`, {});
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-24: auto-marca como 'kept' todas las pendientes con
   * aiValidityScore >= 0.7. Acelera curación masiva post-pasada IA.
   */
  autoKeepHighScore: async (itemId: string): Promise<{ keptCount: number }> => {
    const r = await apiClient.post<any>(`/admin/mercadolibre/publications/${encodeURIComponent(itemId)}/auto-keep-high-score`, {});
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-24: ingesta en lote — pasás un array de MLA IDs
   * y los ingiere uno por uno con resumen totales.
   */
  bulkIngest: async (itemIds: string[], accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2'): Promise<{
    results: Array<{ itemId: string; fetched: number; inserted: number; skipped: number; errored: number }>;
    totals: { fetched: number; inserted: number; skipped: number; errored: number };
  }> => {
    const r = await apiClient.post<any>(`/admin/mercadolibre/publications/bulk-ingest`, { itemIds, accountKey });
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-25: ingiere TODO el catálogo activo. Auto-descubre
   * las publicaciones via ML API y las pasa por bulk-ingest. ADMIN-only.
   */
  ingestAllCatalog: async (accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2' | 'both'): Promise<{
    totals: { items: number; fetched: number; inserted: number; skipped: number; errored: number };
    note?: string;
  }> => {
    const r = await apiClient.post<any>(`/admin/mercadolibre/publications/ingest-all-catalog`, { accountKey: accountKey ?? 'both' });
    return r.data?.data ?? r.data;
  },
  /** Marcos 2026-06-25: setea el override del modo cerrado por publicación. */
  setClosedMode: async (itemId: string, mode: 'auto' | 'always-draft' | 'always-send'): Promise<void> => {
    await apiClient.post<any>(`/admin/mercadolibre/publications/${encodeURIComponent(itemId)}/closed-mode`, { mode });
  },
  /**
   * Marcos 2026-06-25 ("probar respuesta"): corre el modo cerrado
   * sobre una pregunta hipotética. Permite ver qué respondería el
   * agente antes de que llegue tráfico real. Bypassa el feature flag.
   */
  testConstrainedReply: async (
    itemId: string,
    question: string,
    nickname?: string,
  ): Promise<{
    reply: string | null;
    usedConstrained: boolean;
    reason: string;
    curatedRowsUsed: number;
    selfEvalScore: number | null;
    autoSendAllowed: boolean;
    elapsedMs: number;
  }> => {
    const r = await apiClient.post<any>(
      `/admin/mercadolibre/publications/${encodeURIComponent(itemId)}/test-constrained-reply`,
      { question, nickname },
    );
    return r.data?.data ?? r.data;
  },
  /**
   * Marcos 2026-06-25 (Phase D widget): stats del modo cerrado para el
   * dashboard — total replies, auto-sent vs drafted, histograma del
   * self-eval, top publicaciones. Default ventana 30 días.
   */
  closedModeStats: async (days: number = 30): Promise<{
    windowDays: number;
    total: number;
    autoSent: number;
    drafted: number;
    avgScore: number | null;
    autoSendThreshold: number;
    buckets: Array<{ label: string; min: number; max: number; count: number }>;
    topPublications: Array<{ itemId: string; count: number; avgScore: number }>;
  }> => {
    const r = await apiClient.get<any>(`/admin/mercadolibre/publications/closed-mode-stats?days=${days}`);
    return r.data?.data ?? r.data;
  },
};

export const competitorsApi = {
  list: async (productId: string, opts?: { force?: boolean }): Promise<CompetitorList> => {
    const params = new URLSearchParams();
    params.set('productId', productId);
    if (opts?.force) params.set('force', '1');
    const r = await apiClient.get<any>(`/admin/competitors?${params.toString()}`);
    return r.data?.data ?? r.data;
  },
  // Marcos 2026-06-24: vista agregada para /competidores. Devuelve
  // TODOS los productos que tengan watches cargados, con los watches
  // hydratados en vivo (precio + stock del competidor).
  listAll: async (opts?: { force?: boolean }): Promise<CompetitorList[]> => {
    const params = new URLSearchParams();
    if (opts?.force) params.set('force', '1');
    const qs = params.toString();
    const r = await apiClient.get<any>(`/admin/competitors${qs ? `?${qs}` : ''}`);
    return r.data?.data ?? r.data ?? [];
  },
  add: async (input: { productId: string; itemId: string; label?: string }): Promise<CompetitorWatch> => {
    const r = await apiClient.post<any>('/admin/competitors', input);
    return r.data?.data ?? r.data;
  },
  remove: async (watchId: string): Promise<void> => {
    await apiClient.delete(`/admin/competitors/${watchId}`);
  },
};

export const api = {
  auth: authApi,
  users: usersApi,
  conversations: conversationsApi,
  contacts: contactsApi,
  knowledge: knowledgeApi,
  analytics: analyticsApi,
  leads: leadsApi,
  orders: ordersApi,
  campaigns: campaignsApi,
  products: productsApi,
  quotes: quotesApi,
  aiBudget: aiBudgetApi,
  audit: auditApi,
  digest: digestApi,
  config: configApi,
  integrations: integrationsApi,
  leadDetection: leadDetectionApi,
  laminados: laminadosApi,
  mercadolibre: mercadolibreApi,
  quality: qualityApi,
  sandbox: sandboxApi,
  prfvPlacas: prfvPlacasApi,
  dailyLogistica: dailyLogisticaApi,
  publicationFaqs: publicationFaqsApi,
  competitors: competitorsApi,
  dispatchTariffs: dispatchTariffsApi,
  operationalResponsibles: operationalResponsiblesApi,
  mlPublicationKnowledge: mlPublicationKnowledgeApi,
};

export default api;
