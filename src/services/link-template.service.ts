import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('link-template');

const TPL_PREFIX = 'linktpl:';
const TPL_TTL = 365 * 24 * 60 * 60;
const MAX_TEMPLATES = 20;

export interface LinkTemplate {
  id: string;
  merchantId: string;
  name: string;
  amount: number | null;
  description: string | null;
  expiresInHours: number;
  maxUses: number | null;
  usageCount: number;
  createdAt: string;
}

export class LinkTemplateService {
  /**
   * Create a reusable payment link template.
   */
  async createTemplate(input: {
    merchantId: string;
    name: string;
    amount?: number;
    description?: string;
    expiresInHours?: number;
    maxUses?: number;
  }): Promise<LinkTemplate> {
    if (!input.name || input.name.length > 100) {
      throw new Error('Nombre debe tener entre 1 y 100 caracteres.');
    }

    const templates = await this.getTemplates(input.merchantId);
    if (templates.length >= MAX_TEMPLATES) {
      throw new Error(`Máximo ${MAX_TEMPLATES} templates.`);
    }

    const template: LinkTemplate = {
      id: `tpl_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      name: input.name,
      amount: input.amount ?? null,
      description: input.description ?? null,
      expiresInHours: input.expiresInHours ?? 24,
      maxUses: input.maxUses ?? null,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };

    templates.push(template);
    await this.saveTemplates(input.merchantId, templates);

    log.info('Link template created', { merchantId: input.merchantId, templateId: template.id });
    return template;
  }

  /**
   * Get all templates for a merchant.
   */
  async getTemplates(merchantId: string): Promise<LinkTemplate[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TPL_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as LinkTemplate[] : [];
    } catch {
      return [];
    }
  }

  /**
   * Get a specific template.
   */
  async getTemplate(merchantId: string, templateId: string): Promise<LinkTemplate | null> {
    const templates = await this.getTemplates(merchantId);
    return templates.find(t => t.id === templateId) ?? null;
  }

  /**
   * Delete a template.
   */
  async deleteTemplate(merchantId: string, templateId: string): Promise<boolean> {
    const templates = await this.getTemplates(merchantId);
    const filtered = templates.filter(t => t.id !== templateId);
    if (filtered.length === templates.length) return false;
    await this.saveTemplates(merchantId, filtered);
    return true;
  }

  /**
   * Record that a template was used to create a link.
   */
  async recordUsage(merchantId: string, templateId: string): Promise<void> {
    const templates = await this.getTemplates(merchantId);
    const tpl = templates.find(t => t.id === templateId);
    if (tpl) {
      tpl.usageCount++;
      await this.saveTemplates(merchantId, templates);
    }
  }

  /**
   * Get summary with formatted amounts.
   */
  getTemplateSummary(template: LinkTemplate): string {
    const parts = [template.name];
    if (template.amount) parts.push(formatCLP(template.amount));
    if (template.description) parts.push(template.description);
    return parts.join(' — ');
  }

  private async saveTemplates(merchantId: string, templates: LinkTemplate[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${TPL_PREFIX}${merchantId}`, JSON.stringify(templates), { EX: TPL_TTL });
    } catch (err) {
      log.warn('Failed to save templates', { merchantId, error: (err as Error).message });
    }
  }
}

export const linkTemplates = new LinkTemplateService();
