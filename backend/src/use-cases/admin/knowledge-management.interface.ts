/**
 * USE CASES LAYER - Knowledge Base Management Interface
 * Defines knowledge base management operations for admin dashboard
 */

export interface KnowledgeListFilter {
  category?: string;
  subcategory?: string;
  search?: string; // Search in title and content
  active?: boolean;
  limit?: number;
  offset?: number;
}

export interface KnowledgeDetails {
  id: string;
  category: string;
  subcategory: string | null;
  title: string;
  content: string;
  active: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeInput {
  category: string;
  subcategory?: string;
  title: string;
  content: string;
  active?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateKnowledgeInput {
  category?: string;
  subcategory?: string;
  title?: string;
  content?: string;
  active?: boolean;
  metadata?: Record<string, any>;
}

export interface KnowledgeStatistics {
  total: number;
  active: number;
  inactive: number;
  byCategory: Record<string, number>;
  recentlyUpdated: number; // Updated in last 7 days
}

export interface IKnowledgeManagementService {
  /**
   * List knowledge base items with filters and pagination
   */
  listKnowledge(filter: KnowledgeListFilter): Promise<{
    items: KnowledgeDetails[];
    total: number;
  }>;

  /**
   * Get single knowledge base item by ID
   */
  getKnowledgeById(knowledgeId: string): Promise<KnowledgeDetails | null>;

  /**
   * Create new knowledge base item
   */
  createKnowledge(input: CreateKnowledgeInput): Promise<KnowledgeDetails | null>;

  /**
   * Update existing knowledge base item
   */
  updateKnowledge(
    knowledgeId: string,
    input: UpdateKnowledgeInput,
  ): Promise<KnowledgeDetails | null>;

  /**
   * Delete knowledge base item
   */
  deleteKnowledge(knowledgeId: string): Promise<boolean>;

  /**
   * Search knowledge base by title or content
   */
  searchKnowledge(query: string, limit?: number): Promise<KnowledgeDetails[]>;

  /**
   * Get all unique categories
   */
  getCategories(): Promise<string[]>;

  /**
   * Get subcategories for a specific category
   */
  getSubcategories(category: string): Promise<string[]>;

  /**
   * Get knowledge base statistics
   */
  getStatistics(): Promise<KnowledgeStatistics>;

  /**
   * Toggle active status
   */
  toggleActive(knowledgeId: string): Promise<boolean>;
}
