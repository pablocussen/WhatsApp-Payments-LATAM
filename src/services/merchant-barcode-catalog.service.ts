import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-barcode-catalog');
const PREFIX = 'merchant:barcode:';
const TTL = 365 * 24 * 60 * 60;

export interface BarcodeEntry {
  barcode: string;
  merchantId: string;
  productName: string;
  price: number;
  sku: string;
  stock: number;
  category: string;
  lastScanAt?: string;
  scanCount: number;
  createdAt: string;
}

export class MerchantBarcodeCatalogService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  private validateBarcode(barcode: string): boolean {
    return /^[0-9]{8,14}$/.test(barcode);
  }

  async list(merchantId: string): Promise<BarcodeEntry[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async addEntry(input: {
    merchantId: string;
    barcode: string;
    productName: string;
    price: number;
    sku: string;
    stock: number;
    category: string;
  }): Promise<BarcodeEntry> {
    if (!this.validateBarcode(input.barcode)) {
      throw new Error('Codigo de barras debe ser 8-14 digitos');
    }
    if (input.price < 0) throw new Error('Precio no puede ser negativo');
    if (input.stock < 0) throw new Error('Stock no puede ser negativo');
    if (input.productName.length > 100) throw new Error('Nombre excede 100 caracteres');
    const list = await this.list(input.merchantId);
    if (list.some(e => e.barcode === input.barcode)) {
      throw new Error('Codigo de barras ya existe');
    }
    if (list.length >= 5000) throw new Error('Maximo 5000 productos por catalogo');
    const entry: BarcodeEntry = {
      barcode: input.barcode,
      merchantId: input.merchantId,
      productName: input.productName,
      price: input.price,
      sku: input.sku,
      stock: input.stock,
      category: input.category,
      scanCount: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('barcode entry added', { merchantId: input.merchantId, barcode: input.barcode });
    return entry;
  }

  async lookup(merchantId: string, barcode: string): Promise<BarcodeEntry | null> {
    const list = await this.list(merchantId);
    const entry = list.find(e => e.barcode === barcode);
    if (!entry) return null;
    entry.scanCount++;
    entry.lastScanAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return entry;
  }

  async updateStock(merchantId: string, barcode: string, delta: number): Promise<BarcodeEntry | null> {
    const list = await this.list(merchantId);
    const entry = list.find(e => e.barcode === barcode);
    if (!entry) return null;
    const newStock = entry.stock + delta;
    if (newStock < 0) throw new Error('Stock resultante negativo');
    entry.stock = newStock;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return entry;
  }

  async updatePrice(merchantId: string, barcode: string, price: number): Promise<BarcodeEntry | null> {
    if (price < 0) throw new Error('Precio no puede ser negativo');
    const list = await this.list(merchantId);
    const entry = list.find(e => e.barcode === barcode);
    if (!entry) return null;
    entry.price = price;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return entry;
  }

  async delete(merchantId: string, barcode: string): Promise<boolean> {
    const list = await this.list(merchantId);
    const idx = list.findIndex(e => e.barcode === barcode);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getMostScanned(merchantId: string, limit = 10): Promise<BarcodeEntry[]> {
    const list = await this.list(merchantId);
    return [...list].sort((a, b) => b.scanCount - a.scanCount).slice(0, limit);
  }

  async getLowStock(merchantId: string, threshold = 5): Promise<BarcodeEntry[]> {
    const list = await this.list(merchantId);
    return list.filter(e => e.stock <= threshold);
  }

  async searchByName(merchantId: string, query: string): Promise<BarcodeEntry[]> {
    const list = await this.list(merchantId);
    const q = query.toLowerCase();
    return list.filter(e => e.productName.toLowerCase().includes(q));
  }
}

export const merchantBarcodeCatalog = new MerchantBarcodeCatalogService();
