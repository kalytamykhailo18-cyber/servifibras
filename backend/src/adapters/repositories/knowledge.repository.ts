/**
 * ADAPTERS LAYER - Knowledge Repository Implementation
 * Implements IKnowledgeRepository using Prisma
 */

import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  IKnowledgeRepository,
  KnowledgeItem,
} from '../../domain/repositories/knowledge.repository.interface';

@Injectable()
export class KnowledgeRepository implements IKnowledgeRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getAllActive(): Promise<KnowledgeItem[]> {
    const items = await this.prisma.knowledgeBase.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { subcategory: 'asc' }],
    });

    return items.map((item) => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      title: item.title,
      content: item.content,
      active: item.active,
    }));
  }

  async getByCategory(category: string): Promise<KnowledgeItem[]> {
    const items = await this.prisma.knowledgeBase.findMany({
      where: {
        category: category,
        active: true,
      },
      orderBy: { subcategory: 'asc' },
    });

    return items.map((item) => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      title: item.title,
      content: item.content,
      active: item.active,
    }));
  }

  async search(query: string): Promise<KnowledgeItem[]> {
    const items = await this.prisma.knowledgeBase.findMany({
      where: {
        AND: [
          { active: true },
          {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { content: { contains: query, mode: 'insensitive' } },
              { category: { contains: query, mode: 'insensitive' } },
              { subcategory: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
    });

    return items.map((item) => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      title: item.title,
      content: item.content,
      active: item.active,
    }));
  }

  async getFormattedForAI(): Promise<string> {
    const items = await this.getAllActive();

    let formatted = '# Servifibras - Product Knowledge Base\n\n';
    formatted += 'You are a technical expert helping customers of Servifibras, an Argentine distributor of composite materials.\n\n';

    // Group by category
    const categories = new Map<string, KnowledgeItem[]>();
    items.forEach((item) => {
      const existing = categories.get(item.category) || [];
      categories.set(item.category, [...existing, item]);
    });

    // Format each category
    categories.forEach((items, category) => {
      formatted += `## ${category}\n\n`;

      items.forEach((item) => {
        if (item.subcategory) {
          formatted += `### ${item.subcategory}: ${item.title}\n`;
        } else {
          formatted += `### ${item.title}\n`;
        }
        formatted += `${item.content}\n\n`;
      });
    });

    formatted += '\n---\n\n';
    formatted += 'When answering:\n';
    formatted += '- Always respond in Spanish (the customer\'s language)\n';
    formatted += '- Be technical but clear\n';
    formatted += '- Recommend specific products based on use case\n';
    formatted += '- Mention safety considerations when relevant\n';
    formatted += '- If you don\'t know something, say so - don\'t make up information\n';

    return formatted;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
