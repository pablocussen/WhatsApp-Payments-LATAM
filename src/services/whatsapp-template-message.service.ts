import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('wa-template');
const WT_PREFIX = 'watpl:';
const WT_TTL = 365 * 24 * 60 * 60;

export type TemplateCategory = 'TRANSACTIONAL' | 'MARKETING' | 'NOTIFICATION' | 'AUTHENTICATION';

export interface WATemplate {
  id: string;
  merchantId: string;
  name: string;
  category: TemplateCategory;
  language: 'es' | 'en';
  bodyText: string;
  variables: string[];
  approved: boolean;
  usageCount: number;
  createdAt: string;
}

export class WhatsAppTemplateMessageService {
  async createTemplate(input: { merchantId: string; name: string; category: TemplateCategory; language: 'es' | 'en'; bodyText: string }): Promise<WATemplate> {
    if (!input.name || input.name.length > 50) throw new Error('Nombre entre 1 y 50 caracteres.');
    if (!input.bodyText || input.bodyText.length > 1024) throw new Error('Texto entre 1 y 1024 caracteres.');
    const variables = this.extractVariables(input.bodyText);
    const tpl: WATemplate = {
      id: 'wat_' + Date.now().toString(36),
      merchantId: input.merchantId, name: input.name, category: input.category,
      language: input.language, bodyText: input.bodyText, variables,
      approved: false, usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(WT_PREFIX + tpl.id, JSON.stringify(tpl), { EX: WT_TTL }); }
    catch (err) { log.warn('Failed to save template', { error: (err as Error).message }); }
    return tpl;
  }

  async getTemplate(id: string): Promise<WATemplate | null> {
    try { const redis = getRedis(); const raw = await redis.get(WT_PREFIX + id); return raw ? JSON.parse(raw) as WATemplate : null; }
    catch { return null; }
  }

  async approveTemplate(id: string): Promise<boolean> {
    const tpl = await this.getTemplate(id);
    if (!tpl) return false;
    tpl.approved = true;
    try { const redis = getRedis(); await redis.set(WT_PREFIX + id, JSON.stringify(tpl), { EX: WT_TTL }); }
    catch { return false; }
    return true;
  }

  async render(id: string, vars: Record<string, string>): Promise<string | null> {
    const tpl = await this.getTemplate(id);
    if (!tpl || !tpl.approved) return null;
    let text = tpl.bodyText;
    for (const v of tpl.variables) {
      text = text.replace(new RegExp('\{\{' + v + '\}\}', 'g'), vars[v] ?? '');
    }
    tpl.usageCount++;
    try { const redis = getRedis(); await redis.set(WT_PREFIX + id, JSON.stringify(tpl), { EX: WT_TTL }); }
    catch { /* ignore */ }
    return text;
  }

  private extractVariables(text: string): string[] {
    const matches = text.match(/\{\{([a-zA-Z_]+)\}\}/g) ?? [];
    return [...new Set(matches.map(m => m.slice(2, -2)))];
  }
}

export const whatsappTemplateMessage = new WhatsAppTemplateMessageService();
