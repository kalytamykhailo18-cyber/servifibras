/**
 * DOMAIN LAYER - Knowledge Repository Interface
 * Defines what operations we can do with knowledge, not how
 */

export interface KnowledgeItem {
  id: string;
  category: string;
  subcategory: string | null;
  title: string;
  content: string;
  active: boolean;
}

export interface IKnowledgeRepository {
  /**
   * Get all active knowledge items
   */
  getAllActive(): Promise<KnowledgeItem[]>;

  /**
   * Get knowledge by category
   */
  getByCategory(category: string): Promise<KnowledgeItem[]>;

  /**
   * Search knowledge by keywords
   */
  search(query: string): Promise<KnowledgeItem[]>;

  /**
   * Get formatted knowledge base for AI context
   */
  getFormattedForAI(): Promise<string>;
}
