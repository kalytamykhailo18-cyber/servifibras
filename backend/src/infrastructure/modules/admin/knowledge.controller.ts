/**
 * INFRASTRUCTURE LAYER - Admin Knowledge Base Controller
 * Manages knowledge base CRUD operations, search, and statistics
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { KnowledgeManagementService } from '../../../adapters/admin/knowledge-management.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';

@Controller('admin/knowledge')
@UseGuards(AuthGuard, RolesGuard)
export class KnowledgeController {
  private readonly logger = new Logger(KnowledgeController.name);

  constructor(
    private readonly knowledgeManagement: KnowledgeManagementService,
  ) {}

  /**
   * Get knowledge base statistics
   * GET /admin/knowledge/stats/summary
   */
  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getStatistics() {
    const stats = await this.knowledgeManagement.getStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Get all unique categories
   * GET /admin/knowledge/categories
   */
  @Get('categories')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getCategories() {
    const categories = await this.knowledgeManagement.getCategories();

    return {
      success: true,
      data: categories,
    };
  }

  /**
   * Get subcategories for a category
   * GET /admin/knowledge/categories/:category/subcategories
   */
  @Get('categories/:category/subcategories')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getSubcategories(@Param('category') category: string) {
    const subcategories = await this.knowledgeManagement.getSubcategories(
      category,
    );

    return {
      success: true,
      data: subcategories,
    };
  }

  /**
   * Search knowledge base
   * GET /admin/knowledge/search
   */
  @Get('search')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async searchKnowledge(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    if (!query) {
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }

    const items = await this.knowledgeManagement.searchKnowledge(
      query,
      limit ? parseInt(limit) : 20,
    );

    return {
      success: true,
      data: items,
      total: items.length,
    };
  }

  /**
   * List all knowledge base items with filters
   * GET /admin/knowledge
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async listKnowledge(
    @Query('category') category?: string,
    @Query('subcategory') subcategory?: string,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.knowledgeManagement.listKnowledge({
      category,
      subcategory,
      search,
      active: active !== undefined ? active === 'true' : undefined,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    return {
      success: true,
      data: result.items,
      total: result.total,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };
  }

  /**
   * Get single knowledge base item
   * GET /admin/knowledge/:id
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getKnowledge(@Param('id') id: string) {
    const item = await this.knowledgeManagement.getKnowledgeById(id);

    if (!item) {
      return {
        success: false,
        error: 'Knowledge item not found',
      };
    }

    return {
      success: true,
      data: item,
    };
  }

  /**
   * Create new knowledge base item
   * POST /admin/knowledge
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async createKnowledge(
    @Body()
    body: {
      category: string;
      subcategory?: string;
      title: string;
      content: string;
      active?: boolean;
      metadata?: Record<string, any>;
    },
  ) {
    if (!body.category || !body.title || !body.content) {
      return {
        success: false,
        error: 'Category, title, and content are required',
      };
    }

    const item = await this.knowledgeManagement.createKnowledge({
      category: body.category,
      subcategory: body.subcategory,
      title: body.title,
      content: body.content,
      active: body.active,
      metadata: body.metadata,
    });

    if (item) {
      this.logger.log(`Knowledge item created: ${item.id} by admin`);
      return { success: true, data: item };
    } else {
      return { success: false, error: 'Failed to create knowledge item' };
    }
  }

  /**
   * Update existing knowledge base item
   * PUT /admin/knowledge/:id
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async updateKnowledge(
    @Param('id') id: string,
    @Body()
    body: {
      category?: string;
      subcategory?: string;
      title?: string;
      content?: string;
      active?: boolean;
      metadata?: Record<string, any>;
    },
  ) {
    const item = await this.knowledgeManagement.updateKnowledge(id, body);

    if (item) {
      this.logger.log(`Knowledge item updated: ${id} by admin`);
      return { success: true, data: item };
    } else {
      return { success: false, error: 'Failed to update knowledge item' };
    }
  }

  /**
   * Toggle active status
   * POST /admin/knowledge/:id/toggle
   */
  @Post(':id/toggle')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async toggleActive(@Param('id') id: string) {
    const success = await this.knowledgeManagement.toggleActive(id);

    if (success) {
      this.logger.log(`Knowledge item toggled: ${id} by admin`);
      return { success: true, message: 'Active status toggled' };
    } else {
      return { success: false, error: 'Failed to toggle active status' };
    }
  }

  /**
   * Delete knowledge base item
   * DELETE /admin/knowledge/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteKnowledge(@Param('id') id: string) {
    const success = await this.knowledgeManagement.deleteKnowledge(id);

    if (success) {
      this.logger.log(`Knowledge item deleted: ${id} by admin`);
      return { success: true, message: 'Knowledge item deleted' };
    } else {
      return {
        success: false,
        error: 'Failed to delete knowledge item',
      };
    }
  }
}
