import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-qr-print-template');
const PREFIX = 'merchant:qr-print-tpl:';
const TTL = 365 * 24 * 60 * 60;

export type TemplateSize = 'A4' | 'A5' | 'A6' | 'TICKET_80MM';
export type TemplateStyle = 'MINIMAL' | 'BRANDED' | 'PROMOTIONAL';

export interface QRPrintTemplate {
  id: string;
  merchantId: string;
  name: string;
  size: TemplateSize;
  style: TemplateStyle;
  headerText: string;
  footerText: string;
  showLogo: boolean;
  showAmount: boolean;
  primaryColor: string;
  downloads: number;
  createdAt: string;
}

export class MerchantQRPrintTemplateService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<QRPrintTemplate[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  private validColor(color: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(color);
  }

  async create(input: {
    merchantId: string;
    name: string;
    size: TemplateSize;
    style: TemplateStyle;
    headerText: string;
    footerText: string;
    showLogo?: boolean;
    showAmount?: boolean;
    primaryColor?: string;
  }): Promise<QRPrintTemplate> {
    if (input.name.length > 40) throw new Error('Nombre excede 40 caracteres');
    if (input.headerText.length > 60) throw new Error('Encabezado excede 60 caracteres');
    if (input.footerText.length > 60) throw new Error('Pie excede 60 caracteres');
    const color = input.primaryColor ?? '#06b6d4';
    if (!this.validColor(color)) throw new Error('Color debe ser formato #RRGGBB');
    const list = await this.list(input.merchantId);
    if (list.length >= 10) throw new Error('Maximo 10 plantillas por comercio');
    const tpl: QRPrintTemplate = {
      id: `qrtpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      name: input.name,
      size: input.size,
      style: input.style,
      headerText: input.headerText,
      footerText: input.footerText,
      showLogo: input.showLogo ?? true,
      showAmount: input.showAmount ?? false,
      primaryColor: color,
      downloads: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(tpl);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('template created', { id: tpl.id });
    return tpl;
  }

  async incrementDownloads(merchantId: string, id: string): Promise<QRPrintTemplate | null> {
    const list = await this.list(merchantId);
    const tpl = list.find(t => t.id === id);
    if (!tpl) return null;
    tpl.downloads++;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return tpl;
  }

  async delete(merchantId: string, id: string): Promise<boolean> {
    const list = await this.list(merchantId);
    const idx = list.findIndex(t => t.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getMostDownloaded(merchantId: string): Promise<QRPrintTemplate | null> {
    const list = await this.list(merchantId);
    if (list.length === 0) return null;
    return list.reduce((max, t) => t.downloads > max.downloads ? t : max);
  }

  formatPrintSpec(tpl: QRPrintTemplate): string {
    const sizes: Record<TemplateSize, string> = {
      A4: '210x297mm',
      A5: '148x210mm',
      A6: '105x148mm',
      TICKET_80MM: '80x200mm',
    };
    return `${tpl.name} | ${sizes[tpl.size]} | ${tpl.style} | ${tpl.primaryColor}`;
  }
}

export const merchantQRPrintTemplate = new MerchantQRPrintTemplateService();
