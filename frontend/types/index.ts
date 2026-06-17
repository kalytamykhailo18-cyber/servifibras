// ============================================================================
// SERVIFIBRAS FRONTEND - TypeScript Type Definitions
// ============================================================================
// Matches backend Prisma schema exactly for type safety across full stack
// Team: Brenda (ATENCION), Franco (VENTAS), Aldo (LOGISTICA), Marcos (ADMIN)
// Products: Resinas, Fibra de Vidrio, Cauchos
// ============================================================================

// ============================================================================
// ENUMS (Match Prisma schema exactly)
// ============================================================================

export enum UserRole {
  ADMIN = "ADMIN",           // Marcos + Socia - full access
  ATENCION = "ATENCION",     // Brenda - customer service
  VENTAS = "VENTAS",         // Franco - sales
  LOGISTICA = "LOGISTICA",   // Aldo - logistics
  ENCARGADO = "ENCARGADO",   // Marcos 2026-06-17 — supervisor / team lead
}

export enum ContactType {
  MINORISTA = "MINORISTA",       // Retail
  MAYORISTA = "MAYORISTA",       // Wholesale
  EMPRENDEDOR = "EMPRENDEDOR",   // Entrepreneur
  INDUSTRIAL = "INDUSTRIAL",     // Industrial
}

// Marcos's 2-dimension classification — replaces the flat ContactType for
// new code. The legacy ContactType enum is kept while consumers migrate.
export enum CustomerType {
  ARTESANO = "ARTESANO",
  EMPRENDEDOR = "EMPRENDEDOR",
  MAYORISTA = "MAYORISTA",
  INDUSTRIAL = "INDUSTRIAL",
  PRFV_LAMINADOS = "PRFV_LAMINADOS",
  PROVEEDOR = "PROVEEDOR",
}

export enum FunnelStage {
  CONSULTA = "CONSULTA",
  COTIZADO = "COTIZADO",
  NO_CONCRETO = "NO_CONCRETO",
  COMPRADOR = "COMPRADOR",
  FRECUENTE = "FRECUENTE",
  REACTIVAR = "REACTIVAR",
}

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  [CustomerType.ARTESANO]: "Artesano / Hobbysta",
  [CustomerType.EMPRENDEDOR]: "Emprendedor",
  [CustomerType.MAYORISTA]: "Mayorista",
  [CustomerType.INDUSTRIAL]: "Industrial",
  [CustomerType.PRFV_LAMINADOS]: "PRFV / Laminados",
  [CustomerType.PROVEEDOR]: "Proveedor",
};

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  [FunnelStage.CONSULTA]: "Consulta",
  [FunnelStage.COTIZADO]: "Cotizado",
  [FunnelStage.NO_CONCRETO]: "No concretó",
  [FunnelStage.COMPRADOR]: "Comprador",
  [FunnelStage.FRECUENTE]: "Cliente frecuente",
  [FunnelStage.REACTIVAR]: "Reactivar",
};

export enum Channel {
  WHATSAPP = "WHATSAPP",
  FACEBOOK = "FACEBOOK",
  INSTAGRAM = "INSTAGRAM",
  MERCADOLIBRE = "MERCADOLIBRE",
  TIENDANUBE_WEBCHAT = "TIENDANUBE_WEBCHAT",
}

export enum ConversationStatus {
  ACTIVE = "ACTIVE",       // Ongoing conversation
  CLOSED = "CLOSED",       // Resolved
  WAITING = "WAITING",     // Waiting for customer response
}

export enum MessageSender {
  CUSTOMER = "CUSTOMER",
  AI = "AI",
  BRENDA = "BRENDA",
  FRANCO = "FRANCO",
  ALDO = "ALDO",
  ADMIN = "ADMIN",
}

export enum ContentType {
  TEXT = "TEXT",
  IMAGE = "IMAGE",
  VOICE = "VOICE",
  VIDEO = "VIDEO",
  DOCUMENT = "DOCUMENT",
  LOCATION = "LOCATION",
}

export enum LeadStatus {
  NEW = "NEW",               // Just detected
  CONTACTED = "CONTACTED",   // Franco reached out
  QUOTE_SENT = "QUOTE_SENT", // Quotation sent
  NEGOTIATING = "NEGOTIATING", // Back and forth
  WON = "WON",               // Deal closed
  LOST = "LOST",             // Customer declined
}

export enum OrderStatus {
  CONFIRMED = "CONFIRMED",
  PROCESSING = "PROCESSING",
  DISPATCHED = "DISPATCHED",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
}

export enum ConfigurationType {
  CHANNEL = "CHANNEL",
  AI = "AI",
  PRICING = "PRICING",
  SYSTEM = "SYSTEM",
}

// ============================================================================
// DATABASE MODELS (Match Prisma schema exactly)
// ============================================================================

export interface User {
  id: string;
  email: string;
  username: string;
  password: string; // Hashed with bcrypt
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
}

export interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  type: ContactType;
  // 2D classification (Marcos's redesign) — either field may be null
  // until the contact has been classified.
  customerType?: CustomerType | null;
  funnelStage?: FunnelStage | null;
  channel: Channel | null;
  metadata: Record<string, any> | null;
  // Optional avatar pulled from the platform on first contact (Graph API
  // for FB Messenger + IG). WhatsApp / ML / webchat fall back to the
  // initials gradient. Server returns null when not available.
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  channel: Channel;
  status: ConversationStatus;
  assignedTo: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  isUnread: boolean;
  // True while the conversation is parked waiting for a human (AI handed
  // off, or customer explicitly asked for a person). Cleared when any staff
  // member sends a reply through the panel.
  needsHumanAttention?: boolean;
  escalatedAt?: string | null;
  // Per-conversation AI kill-switch toggled from the conversation header.
  // When true the inbound pipeline still saves customer messages but the
  // AI does not reply — operators handle it manually.
  aiPaused?: boolean;
  aiPausedAt?: string | null;
  aiPausedBy?: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  content: string;
  contentType: ContentType;
  isFromAI: boolean;
  metadata: Record<string, any> | null;
  timestamp: string;
  // Optional file attachment metadata. URL is the auth-gated download path
  // (e.g. "/admin/uploads/2026/05/abcdef.png"); the binary lives behind
  // AuthGuard on the backend so it's only fetched with a valid token.
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
  // Per-user attribution for staff replies. Null for CUSTOMER + AI
  // messages (those identify themselves by the `sender` enum). When
  // present, the bubble shows the operator's actual name instead of
  // the generic role label.
  author?: { id: string; name: string } | null;
}

export interface Lead {
  id: string;
  contactId: string;
  assignedTo: string | null;
  status: LeadStatus;
  source: Channel;
  productInterest: string | null;
  estimatedValue: number | null;
  notes: string | null;
  wonAmount: number | null;
  lostReason: string | null;
  // Source conversation, when this lead was auto-detected from a chat
  // thread. The server backfills it from contact+channel for legacy
  // rows so this is reliable for routing the "Ir a la conversación"
  // deep-link.
  sourceConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional relations (when fetched with includes)
  contact?: Contact;
  assigned?: User | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  contactId: string;
  conversationId: string | null;
  amount: number;
  currency: string;
  products: OrderProduct[];
  status: OrderStatus;
  trackingNumber: string | null;
  carrier: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional relations (when fetched with includes)
  contact?: Contact;
}

export interface OrderProduct {
  name: string;
  category: string; // "Resinas", "Fibra de Vidrio", "Cauchos"
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface KnowledgeBase {
  id: string;
  category: string; // "Resinas", "Fibra de Vidrio", "Cauchos"
  subcategory: string | null;
  title: string;
  content: string;
  active: boolean;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Configuration {
  id: string;
  type: ConfigurationType;
  key: string;
  value: Record<string, any>;
  description: string | null;
  isActive: boolean;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// API RESPONSE TYPES (With relations populated)
// ============================================================================

export interface ConversationWithRelations extends Conversation {
  contact: Contact;
  assigned: User | null;
  messages?: Message[];
}

export interface ContactWithRelations extends Contact {
  conversations?: Conversation[];
  leads?: Lead[];
  orders?: Order[];
}

export interface LeadWithRelations extends Lead {
  contact: Contact;
  assigned: User | null;
}

export interface OrderWithRelations extends Order {
  contact: Contact;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  // Backwards-compat — short-lived access token. Same value as accessToken.
  token: string;
  // Short-lived JWT — used as the bearer on every API request.
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  // Long-lived rotation token — exchanged for a new pair via /auth/refresh.
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: User;
}

export interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
}

// Conversations
export interface GetConversationsParams {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
  channel?: Channel;
  assignedTo?: string;
  search?: string;
}

export interface GetConversationsResponse {
  conversations: ConversationWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SendMessageRequest {
  content: string;
  contentType?: ContentType;
}

export interface AssignConversationRequest {
  userId: string;
}

export interface UpdateConversationStatusRequest {
  status: ConversationStatus;
}

// Contacts
export interface GetContactsParams {
  page?: number;
  limit?: number;
  type?: ContactType;
  channel?: Channel;
  search?: string;
}

export interface GetContactsResponse {
  contacts: Contact[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateContactRequest {
  name?: string;
  phone?: string;
  email?: string;
  type: ContactType;
  channel?: Channel;
  metadata?: Record<string, any>;
}

export interface UpdateContactRequest {
  name?: string;
  phone?: string;
  email?: string;
  type?: ContactType;
  metadata?: Record<string, any>;
}

export interface MergeContactsRequest {
  targetContactId: string;
  sourceContactIds: string[];
}

// Knowledge Base
export interface GetKnowledgeParams {
  page?: number;
  limit?: number;
  category?: string;
  subcategory?: string;
  active?: boolean;
  search?: string;
}

export interface GetKnowledgeResponse {
  items: KnowledgeBase[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateKnowledgeRequest {
  category: string;
  subcategory?: string;
  title: string;
  content: string;
  active?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateKnowledgeRequest {
  category?: string;
  subcategory?: string;
  title?: string;
  content?: string;
  active?: boolean;
  metadata?: Record<string, any>;
}

// Analytics - Match backend interfaces exactly
export interface ConversationMetrics {
  total: number;
  active: number;
  closed: number;
  waiting: number;
  avgMessagesPerConversation: number;
  totalMessages: number;
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
  // Summary stats for dashboard cards
  totalConversations?: number;
  activeConversations?: number;
  totalContacts?: number;
  totalLeads?: number;
  totalOrders?: number;
  revenueThisMonth?: number;
}

// Leads
export interface GetLeadsParams {
  page?: number;
  limit?: number;
  status?: LeadStatus;
  assignedTo?: string;
  source?: Channel;
  search?: string;
}

export interface GetLeadsResponse {
  leads: LeadWithRelations[];
  data: LeadWithRelations[]; // Alias for compatibility
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateLeadRequest {
  contactId: string;
  source: Channel;
  productInterest?: string;
  estimatedValue?: number;
  notes?: string;
}

export interface UpdateLeadRequest {
  assignedTo?: string;
  status?: LeadStatus;
  productInterest?: string;
  estimatedValue?: number;
  notes?: string;
}

export interface UpdateLeadStatusRequest {
  status: LeadStatus;
  wonAmount?: number;
  lostReason?: string;
}

export interface LeadPipelineStats {
  totalLeads: number;
  newLeads: number;
  contactedLeads: number;
  quoteSentLeads: number;
  negotiatingLeads: number;
  wonLeads: number;
  lostLeads: number;
  totalRevenue: number;
  conversionRate: number; // percentage
  avgDealSize: number;
  bySource: Record<Channel, number>;
  topProducts: Array<{ product: string; count: number }>;
  // Additional fields for stats component
  byStatus?: Record<string, number>;
  totalEstimatedValue?: number;
  totalWonValue?: number;
  totalLostValue?: number;
  averageDealSize?: number;
}

// Orders
export interface GetOrdersParams {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface GetOrdersResponse {
  orders: OrderWithRelations[];
  data: OrderWithRelations[]; // Alias for compatibility
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateOrderRequest {
  contactId: string;
  conversationId?: string | null;
  orderNumber?: string;
  amount: number;
  currency?: string;
  products: OrderProduct[];
  notes?: string;
  // Marcos 2026-06-12: operator pre-selects which section of the
  // daily logística panel should receive the row.
  sectionOverride?: 'MOTOS' | 'MICROS' | 'RETIRA_CASEROS' | 'LAMINADOS_PRFV' | null;
}

export interface UpdateOrderRequest {
  status?: OrderStatus;
  trackingNumber?: string;
  carrier?: string;
  notes?: string;
  amount?: number;
  currency?: string;
  products?: any; // JSON string or parsed object
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  trackingNumber?: string;
  carrier?: string;
}

export interface OrderFulfillmentStats {
  totalOrders: number;
  totalRevenue: number;
  confirmedOrders: number;
  processingOrders: number;
  dispatchedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  avgOrderValue: number;
  topProducts: Array<{ product: string; quantity: number; revenue: number }>;
  revenueByMonth: Array<{ month: string; revenue: number }>;
  fulfillmentRate: number; // percentage delivered
  // Additional fields for stats component
  byStatus?: Record<string, number>;
  averageOrderValue?: number;
  fulfillmentMetrics?: {
    totalOrders: number;
    delivered: number;
    pending: number;
    rate: number;
  };
}

// Configuration
export interface GetConfigurationsParams {
  type?: ConfigurationType;
  isActive?: boolean;
}

export interface CreateConfigurationRequest {
  type: ConfigurationType;
  key: string;
  value: Record<string, any>;
  description?: string;
  isActive?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateConfigurationRequest {
  value?: Record<string, any>;
  description?: string;
  isActive?: boolean;
  metadata?: Record<string, any>;
}

// ============================================================================
// FORM TYPES (For react-hook-form with zod)
// ============================================================================

export interface LoginFormData {
  email: string;
  password: string;
}

export interface ContactFormData {
  name?: string;
  phone?: string;
  email?: string;
  type: ContactType;
  channel?: Channel;
  // Marcos 2026-06-17: optional fiscal + shipping fields stored on
  // Contact.metadata. Same shape as the inline quick-add form in
  // Pedidos so an edited address rounds-trips into the order PDF
  // + etiqueta envío.
  fiscalId?: string;
  address?: string;
  streetNumber?: string;
  locality?: string;
  postalCode?: string;
}

export interface KnowledgeFormData {
  category: string;
  subcategory?: string;
  title: string;
  content: string;
  active: boolean;
}

export interface LeadFormData {
  contactId: string;
  source: Channel;
  productInterest?: string;
  estimatedValue?: number;
  notes?: string;
}

export interface OrderFormData {
  contactId: string;
  amount: number;
  currency: string;
  products: OrderProduct[];
  notes?: string;
}

export interface SendMessageFormData {
  content: string;
  contentType: ContentType;
}

// ============================================================================
// FILTER TYPES (For UI filter components)
// ============================================================================

export interface ConversationFilters {
  status?: ConversationStatus | "ALL";
  channel?: Channel | "ALL";
  assignedTo?: string | "ALL";
  search?: string;
}

export interface ContactFilters {
  type?: ContactType | "ALL";
  channel?: Channel | "ALL";
  search?: string;
}

export interface KnowledgeFilters {
  category?: string | "ALL";
  subcategory?: string | "ALL";
  active?: boolean | "ALL";
  search?: string;
}

export interface LeadFilters {
  status?: LeadStatus | "ALL";
  assignedTo?: string | "ALL";
  source?: Channel | "ALL";
  search?: string;
}

export interface OrderFilters {
  status?: OrderStatus | "ALL";
  search?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  statusCode: number;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

// ============================================================================
// WEBSOCKET TYPES (For real-time notifications)
// ============================================================================

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: any;
  timestamp: string;
}

export enum WebSocketEventType {
  NEW_MESSAGE = "NEW_MESSAGE",
  CONVERSATION_UPDATED = "CONVERSATION_UPDATED",
  CONVERSATION_ASSIGNED = "CONVERSATION_ASSIGNED",
  LEAD_CREATED = "LEAD_CREATED",
  LEAD_UPDATED = "LEAD_UPDATED",
  ORDER_CREATED = "ORDER_CREATED",
  ORDER_UPDATED = "ORDER_UPDATED",
}

export interface NewMessageEvent {
  messageId: string;
  conversationId: string;
  contactId: string;
  sender: MessageSender;
  content: string;
  channel: Channel;
}

export interface ConversationUpdatedEvent {
  conversationId: string;
  status: ConversationStatus;
  assignedTo: string | null;
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

export interface TableState<T> {
  data: T[];
  isLoading: boolean;
  error: string | null;
  pagination: PaginationMeta;
}

// ============================================================================
// SPANISH TRANSLATIONS (For UI labels)
// ============================================================================

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: "Administrador",
  [UserRole.ATENCION]: "Atención al Cliente",
  [UserRole.VENTAS]: "Ventas",
  [UserRole.LOGISTICA]: "Logística",
  [UserRole.ENCARGADO]: "Encargado",
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  [ContactType.MINORISTA]: "Minorista",
  [ContactType.MAYORISTA]: "Mayorista",
  [ContactType.EMPRENDEDOR]: "Emprendedor",
  [ContactType.INDUSTRIAL]: "Industrial",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  [Channel.WHATSAPP]: "WhatsApp",
  [Channel.FACEBOOK]: "Facebook",
  [Channel.INSTAGRAM]: "Instagram",
  [Channel.MERCADOLIBRE]: "Mercado Libre",
  [Channel.TIENDANUBE_WEBCHAT]: "TiendaNube",
};

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  [ConversationStatus.ACTIVE]: "Activa",
  [ConversationStatus.CLOSED]: "Cerrada",
  [ConversationStatus.WAITING]: "Esperando",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: "Nuevo",
  [LeadStatus.CONTACTED]: "Contactado",
  [LeadStatus.QUOTE_SENT]: "Presupuesto Enviado",
  [LeadStatus.NEGOTIATING]: "Negociando",
  [LeadStatus.WON]: "Ganado",
  [LeadStatus.LOST]: "Perdido",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.CONFIRMED]: "Confirmado",
  [OrderStatus.PROCESSING]: "En Proceso",
  [OrderStatus.DISPATCHED]: "Despachado",
  [OrderStatus.DELIVERED]: "Entregado",
  [OrderStatus.CANCELLED]: "Cancelado",
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  [ContentType.TEXT]: "Texto",
  [ContentType.IMAGE]: "Imagen",
  [ContentType.VOICE]: "Audio",
  [ContentType.VIDEO]: "Video",
  [ContentType.DOCUMENT]: "Documento",
  [ContentType.LOCATION]: "Ubicación",
};

export const PRODUCT_CATEGORIES = [
  "Resinas",
  "Fibra de Vidrio",
  "Cauchos",
] as const;

export type ProductCategory = typeof PRODUCT_CATEGORIES[number];
