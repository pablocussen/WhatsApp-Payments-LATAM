import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('notification-templates');

// ─── Types ──────────────────────────────────────────────

export type TemplateChannel = 'whatsapp' | 'sms' | 'email' | 'push';
export type TemplateCategory =
  | 'payment'
  | 'topup'
  | 'refund'
  | 'security'
  | 'promotion'
  | 'system'
  | 'onboarding';

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: TemplateChannel;
  category: TemplateCategory;
  subject: string | null;       // for email
  body: string;                 // template with {{var}} placeholders
  variables: string[];          // expected variable names
  locale: string;               // es-CL, en, etc.
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RenderedNotification {
  channel: TemplateChannel;
  subject: string | null;
  body: string;
  templateId: string;
  templateVersion: number;
}

const TEMPLATES_PREFIX = 'ntpl:';
const TEMPLATES_INDEX = 'ntpl:index';
const TEMPLATES_TTL = 365 * 24 * 60 * 60;

const VALID_CHANNELS: TemplateChannel[] = ['whatsapp', 'sms', 'email', 'push'];
const VALID_CATEGORIES: TemplateCategory[] = [
  'payment', 'topup', 'refund', 'security', 'promotion', 'system', 'onboarding',
];

// ─── Service ────────────────────────────────────────────

export class NotificationTemplatesService {
  /**
   * Create a new notification template.
   */
  async createTemplate(input: {
    name: string;
    channel: TemplateChannel;
    category: TemplateCategory;
    subject?: string;
    body: string;
    locale?: string;
  }): Promise<NotificationTemplate> {
    // Validation
    if (!input.name || input.name.length > 100) {
      throw new Error('Nombre debe tener entre 1 y 100 caracteres');
    }
    if (!VALID_CHANNELS.includes(input.channel)) {
      throw new Error(`Canal inválido: ${input.channel}`);
    }
    if (!VALID_CATEGORIES.includes(input.category)) {
      throw new Error(`Categoría inválida: ${input.category}`);
    }
    if (!input.body || input.body.length > 4096) {
      throw new Error('Cuerpo del template debe tener entre 1 y 4096 caracteres');
    }
    if (input.channel === 'email' && !input.subject) {
      throw new Error('Email templates requieren un subject');
    }

    // Extract variables from body + subject {{varName}}
    const bodyVars = this.extractVariables(input.body);
    const subjectVars = input.subject ? this.extractVariables(input.subject) : [];
    const variables = [...new Set([...subjectVars, ...bodyVars])];

    const template: NotificationTemplate = {
      id: `ntpl_${randomBytes(8).toString('hex')}`,
      name: input.name,
      channel: input.channel,
      category: input.category,
      subject: input.subject ?? null,
      body: input.body,
      variables,
      locale: input.locale ?? 'es-CL',
      active: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${TEMPLATES_PREFIX}${template.id}`, JSON.stringify(template), { EX: TEMPLATES_TTL });

      // Add to index
      const indexRaw = await redis.get(TEMPLATES_INDEX);
      const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
      index.push(template.id);
      await redis.set(TEMPLATES_INDEX, JSON.stringify(index), { EX: TEMPLATES_TTL });

      log.info('Template created', { id: template.id, name: template.name, channel: template.channel });
    } catch (err) {
      log.warn('Failed to save template', { error: (err as Error).message });
    }

    return template;
  }

  /**
   * Update an existing template (creates new version).
   */
  async updateTemplate(
    templateId: string,
    updates: { body?: string; subject?: string; name?: string },
  ): Promise<NotificationTemplate | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TEMPLATES_PREFIX}${templateId}`);
      if (!raw) return null;

      const template: NotificationTemplate = JSON.parse(raw);

      if (updates.name !== undefined) {
        if (!updates.name || updates.name.length > 100) {
          throw new Error('Nombre debe tener entre 1 y 100 caracteres');
        }
        template.name = updates.name;
      }
      if (updates.body !== undefined) {
        if (!updates.body || updates.body.length > 4096) {
          throw new Error('Cuerpo del template debe tener entre 1 y 4096 caracteres');
        }
        template.body = updates.body;
        template.variables = this.extractVariables(updates.body);
      }
      if (updates.subject !== undefined) {
        template.subject = updates.subject;
      }

      template.version += 1;
      template.updatedAt = new Date().toISOString();

      await redis.set(`${TEMPLATES_PREFIX}${templateId}`, JSON.stringify(template), { EX: TEMPLATES_TTL });
      return template;
    } catch (err) {
      if ((err as Error).message.includes('Nombre') || (err as Error).message.includes('Cuerpo')) {
        throw err;
      }
      log.warn('Failed to update template', { templateId, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Get a template by ID.
   */
  async getTemplate(templateId: string): Promise<NotificationTemplate | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TEMPLATES_PREFIX}${templateId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * List templates, optionally filtered.
   */
  async listTemplates(filters?: {
    channel?: TemplateChannel;
    category?: TemplateCategory;
    active?: boolean;
  }): Promise<NotificationTemplate[]> {
    try {
      const redis = getRedis();
      const indexRaw = await redis.get(TEMPLATES_INDEX);
      if (!indexRaw) return [];

      const ids: string[] = JSON.parse(indexRaw);
      const templates: NotificationTemplate[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${TEMPLATES_PREFIX}${id}`);
        if (raw) {
          const t: NotificationTemplate = JSON.parse(raw);
          if (filters?.channel && t.channel !== filters.channel) continue;
          if (filters?.category && t.category !== filters.category) continue;
          if (filters?.active !== undefined && t.active !== filters.active) continue;
          templates.push(t);
        }
      }

      return templates;
    } catch {
      return [];
    }
  }

  /**
   * Render a template with variable substitution.
   */
  async render(
    templateId: string,
    variables: Record<string, string>,
  ): Promise<RenderedNotification | null> {
    const template = await this.getTemplate(templateId);
    if (!template || !template.active) return null;

    // Check all required variables are provided
    const missing = template.variables.filter((v) => !(v in variables));
    if (missing.length > 0) {
      throw new Error(`Variables faltantes: ${missing.join(', ')}`);
    }

    let body = template.body;
    let subject = template.subject;

    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      body = body.replace(pattern, value);
      if (subject) {
        subject = subject.replace(pattern, value);
      }
    }

    return {
      channel: template.channel,
      subject,
      body,
      templateId: template.id,
      templateVersion: template.version,
    };
  }

  /**
   * Deactivate a template.
   */
  async deactivateTemplate(templateId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TEMPLATES_PREFIX}${templateId}`);
      if (!raw) return false;

      const template: NotificationTemplate = JSON.parse(raw);
      template.active = false;
      template.updatedAt = new Date().toISOString();

      await redis.set(`${TEMPLATES_PREFIX}${templateId}`, JSON.stringify(template), { EX: TEMPLATES_TTL });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find template by name + channel combo.
   */
  async findByName(name: string, channel: TemplateChannel): Promise<NotificationTemplate | null> {
    const templates = await this.listTemplates({ channel });
    return templates.find((t) => t.name === name && t.active) ?? null;
  }

  // ─── Helpers ────────────────────────────────────────────

  extractVariables(body: string): string[] {
    const matches = body.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    const vars = matches.map((m) => m.slice(2, -2));
    return [...new Set(vars)]; // deduplicate
  }
}

export const notificationTemplates = new NotificationTemplatesService();
