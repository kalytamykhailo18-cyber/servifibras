/**
 * ADAPTERS LAYER - Knowledge Base Management Service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  IKnowledgeManagementService,
  KnowledgeListFilter,
  KnowledgeDetails,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  KnowledgeStatistics,
} from '../../use-cases/admin/knowledge-management.interface';

@Injectable()
export class KnowledgeManagementService implements IKnowledgeManagementService {
  private readonly logger = new Logger(KnowledgeManagementService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
    this.logger.log('✅ Knowledge Management service initialized');
  }

  async listKnowledge(filter: KnowledgeListFilter): Promise<{
    items: KnowledgeDetails[];
    total: number;
  }> {
    try {
      const where: any = {};

      if (filter.category) {
        where.category = filter.category;
      }

      if (filter.subcategory) {
        where.subcategory = filter.subcategory;
      }

      if (filter.active !== undefined) {
        where.active = filter.active;
      }

      if (filter.search) {
        where.OR = [
          { title: { contains: filter.search, mode: 'insensitive' } },
          { content: { contains: filter.search, mode: 'insensitive' } },
          { category: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const limit = filter.limit || 50;
      const offset = filter.offset || 0;

      const [items, total] = await Promise.all([
        this.prisma.knowledgeBase.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.knowledgeBase.count({ where }),
      ]);

      const knowledgeDetails: KnowledgeDetails[] = items.map((item) => ({
        id: item.id,
        category: item.category,
        subcategory: item.subcategory,
        title: item.title,
        content: item.content,
        active: item.active,
        metadata: (item.metadata as Record<string, any>) || {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));

      return {
        items: knowledgeDetails,
        total,
      };
    } catch (error: any) {
      this.logger.error(`Error listing knowledge: ${error.message}`);
      return { items: [], total: 0 };
    }
  }

  async getKnowledgeById(knowledgeId: string): Promise<KnowledgeDetails | null> {
    try {
      const item = await this.prisma.knowledgeBase.findUnique({
        where: { id: knowledgeId },
      });

      if (!item) {
        return null;
      }

      return {
        id: item.id,
        category: item.category,
        subcategory: item.subcategory,
        title: item.title,
        content: item.content,
        active: item.active,
        metadata: (item.metadata as Record<string, any>) || {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error getting knowledge: ${error.message}`);
      return null;
    }
  }

  async createKnowledge(
    input: CreateKnowledgeInput,
  ): Promise<KnowledgeDetails | null> {
    try {
      const item = await this.prisma.knowledgeBase.create({
        data: {
          category: input.category,
          subcategory: input.subcategory || null,
          title: input.title,
          content: input.content,
          active: input.active !== undefined ? input.active : true,
          metadata: input.metadata || {},
        },
      });

      this.logger.log(`✅ Knowledge item created: ${item.title} (${item.category})`);

      return {
        id: item.id,
        category: item.category,
        subcategory: item.subcategory,
        title: item.title,
        content: item.content,
        active: item.active,
        metadata: (item.metadata as Record<string, any>) || {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error creating knowledge: ${error.message}`);
      return null;
    }
  }

  async updateKnowledge(
    knowledgeId: string,
    input: UpdateKnowledgeInput,
  ): Promise<KnowledgeDetails | null> {
    try {
      const updateData: any = {};

      if (input.category !== undefined) updateData.category = input.category;
      if (input.subcategory !== undefined) updateData.subcategory = input.subcategory;
      if (input.title !== undefined) updateData.title = input.title;
      if (input.content !== undefined) updateData.content = input.content;
      if (input.active !== undefined) updateData.active = input.active;
      if (input.metadata !== undefined) updateData.metadata = input.metadata;

      const item = await this.prisma.knowledgeBase.update({
        where: { id: knowledgeId },
        data: updateData,
      });

      this.logger.log(`✅ Knowledge item updated: ${knowledgeId}`);

      return {
        id: item.id,
        category: item.category,
        subcategory: item.subcategory,
        title: item.title,
        content: item.content,
        active: item.active,
        metadata: (item.metadata as Record<string, any>) || {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    } catch (error: any) {
      this.logger.error(`Error updating knowledge: ${error.message}`);
      return null;
    }
  }

  async deleteKnowledge(knowledgeId: string): Promise<boolean> {
    try {
      await this.prisma.knowledgeBase.delete({
        where: { id: knowledgeId },
      });

      this.logger.log(`✅ Knowledge item deleted: ${knowledgeId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error deleting knowledge: ${error.message}`);
      return false;
    }
  }

  async searchKnowledge(query: string, limit?: number): Promise<KnowledgeDetails[]> {
    try {
      const items = await this.prisma.knowledgeBase.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
            { category: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit || 20,
        orderBy: { updatedAt: 'desc' },
      });

      return items.map((item) => ({
        id: item.id,
        category: item.category,
        subcategory: item.subcategory,
        title: item.title,
        content: item.content,
        active: item.active,
        metadata: (item.metadata as Record<string, any>) || {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
    } catch (error: any) {
      this.logger.error(`Error searching knowledge: ${error.message}`);
      return [];
    }
  }

  async getCategories(): Promise<string[]> {
    try {
      const result = await this.prisma.knowledgeBase.findMany({
        select: { category: true },
        distinct: ['category'],
        orderBy: { category: 'asc' },
      });

      return result.map((r) => r.category);
    } catch (error: any) {
      this.logger.error(`Error getting categories: ${error.message}`);
      return [];
    }
  }

  async getSubcategories(category: string): Promise<string[]> {
    try {
      const result = await this.prisma.knowledgeBase.findMany({
        where: {
          category,
          subcategory: { not: null },
        },
        select: { subcategory: true },
        distinct: ['subcategory'],
        orderBy: { subcategory: 'asc' },
      });

      return result
        .map((r) => r.subcategory)
        .filter((s): s is string => s !== null);
    } catch (error: any) {
      this.logger.error(`Error getting subcategories: ${error.message}`);
      return [];
    }
  }

  async getStatistics(): Promise<KnowledgeStatistics> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [total, active, byCategory, recentlyUpdated] = await Promise.all([
        this.prisma.knowledgeBase.count(),
        this.prisma.knowledgeBase.count({ where: { active: true } }),
        this.prisma.knowledgeBase.groupBy({
          by: ['category'],
          _count: true,
        }),
        this.prisma.knowledgeBase.count({
          where: {
            updatedAt: {
              gte: sevenDaysAgo,
            },
          },
        }),
      ]);

      const categoryStats: Record<string, number> = {};
      byCategory.forEach((item) => {
        categoryStats[item.category] = item._count;
      });

      return {
        total,
        active,
        inactive: total - active,
        byCategory: categoryStats,
        recentlyUpdated,
      };
    } catch (error: any) {
      this.logger.error(`Error getting statistics: ${error.message}`);
      return {
        total: 0,
        active: 0,
        inactive: 0,
        byCategory: {},
        recentlyUpdated: 0,
      };
    }
  }

  async toggleActive(knowledgeId: string): Promise<boolean> {
    try {
      const item = await this.prisma.knowledgeBase.findUnique({
        where: { id: knowledgeId },
      });

      if (!item) {
        return false;
      }

      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeId },
        data: { active: !item.active },
      });

      this.logger.log(
        `✅ Knowledge item ${knowledgeId} toggled to ${!item.active ? 'active' : 'inactive'}`,
      );
      return true;
    } catch (error: any) {
      this.logger.error(`Error toggling active status: ${error.message}`);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
