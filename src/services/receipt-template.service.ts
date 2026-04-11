import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('receipt-template');

const TPL_PREFIX = 'rcpttpl:';
const TPL_TTL = 365 * 24 * 60 * 60;
const MAX_TEMPLATES = 5;

export interface ReceiptField {
  key: string;
  label: string;
  visible: boolean;
}

export interface ReceiptTemplate {
  id: string;
  merchantId: string;
  name: string;
  headerText: string;
  footerText: string;
  showLogo: boolean;
  showMerchantName: boolean;
  showDate: boolean;
  showReference: boolean;
  showBreakdown: boolean;
  customFields: ReceiptField[];
  thankYouMessage: string;
  isDefault: boolean;
  createdAt: string;
}

export class ReceiptTemplateService {
  async createTemplate(input: {
    merchantId: string;
    name: string;
    headerText?: string;
    footerText?: string;
    thankYouMessage?: string;
  }): Promise<ReceiptTemplate> {
    if (!input.name || input.name.length > 50) throw new Error('Nombre entre 1 y 50 caracteres.');

    const templates = await this.getTemplates(input.merchantId);
    if (templates.length >= MAX_TEMPLATES) throw new Error(`Máximo ${MAX_TEMPLATES} plantillas.`);

    const template: ReceiptTemplate = {
      id: `rtpl_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      name: input.name,
      headerText: input.headerText ?? '',
      footerText: input.footerText ?? '',
      showLogo: true,
      showMerchantName: true,
      showDate: true,
      showReference: true,
      showBreakdown: true,
      customFields: [],
      thankYouMessage: input.thankYouMessage ?? 'Gracias por tu compra!',
      isDefault: templates.length === 0,
      createdAt: new Date().toISOString(),
    };

    templates.push(template);
    await this.save(input.merchantId, templates);

    log.info('Receipt template created', { merchantId: input.merchantId, templateId: template.id });
    return template;
  }

  async getTemplates(merchantId: string): Promise<ReceiptTemplate[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TPL_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as ReceiptTemplate[] : [];
    } catch {
      return [];
    }
  }

  async getDefault(merchantId: string): Promise<ReceiptTemplate | null> {
    const templates = await this.getTemplates(merchantId);
    return templates.find(t => t.isDefault) ?? templates[0] ?? null;
  }

  async setDefault(merchantId: string, templateId: string): Promise<boolean> {
    const templates = await this.getTemplates(merchantId);
    const target = templates.find(t => t.id === templateId);
    if (!target) return false;

    templates.forEach(t => t.isDefault = false);
    target.isDefault = true;
    await this.save(merchantId, templates);
    return true;
  }

  async addCustomField(merchantId: string, templateId: string, field: ReceiptField): Promise<boolean> {
    const templates = await this.getTemplates(merchantId);
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return false;
    if (tpl.customFields.length >= 5) return false;

    tpl.customFields.push(field);
    await this.save(merchantId, templates);
    return true;
  }

  async deleteTemplate(merchantId: string, templateId: string): Promise<boolean> {
    const templates = await this.getTemplates(merchantId);
    const target = templates.find(t => t.id === templateId);
    if (!target) return false;
    if (target.isDefault && templates.length > 1) throw new Error('No se puede eliminar la plantilla por defecto.');

    const filtered = templates.filter(t => t.id !== templateId);
    await this.save(merchantId, filtered);
    return true;
  }

  renderReceipt(template: ReceiptTemplate, data: {
    amount: number;
    reference: string;
    merchantName: string;
    date: string;
    items?: { name: string; amount: number }[];
  }): string {
    const lines: string[] = [];

    if (template.headerText) lines.push(template.headerText);
    if (template.showMerchantName) lines.push(`--- ${data.merchantName} ---`);
    if (template.showDate) lines.push(`Fecha: ${data.date}`);
    if (template.showReference) lines.push(`Ref: ${data.reference}`);

    if (template.showBreakdown && data.items) {
      lines.push('');
      for (const item of data.items) {
        lines.push(`  ${item.name}: ${formatCLP(item.amount)}`);
      }
      lines.push('');
    }

    lines.push(`TOTAL: ${formatCLP(data.amount)}`);

    for (const field of template.customFields) {
      if (field.visible) lines.push(`${field.label}: ${field.key}`);
    }

    if (template.thankYouMessage) lines.push('', template.thankYouMessage);
    if (template.footerText) lines.push(template.footerText);

    return lines.join('\n');
  }

  private async save(merchantId: string, templates: ReceiptTemplate[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${TPL_PREFIX}${merchantId}`, JSON.stringify(templates), { EX: TPL_TTL });
    } catch (err) {
      log.warn('Failed to save templates', { merchantId, error: (err as Error).message });
    }
  }
}

export const receiptTemplates = new ReceiptTemplateService();
