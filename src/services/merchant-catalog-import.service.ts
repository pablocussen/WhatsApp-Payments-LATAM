import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-catalog-import');
const PREFIX = 'merchant:catalog-import:';
const TTL = 30 * 24 * 60 * 60;

export type ImportStatus = 'PARSING' | 'VALIDATED' | 'IMPORTING' | 'COMPLETED' | 'FAILED';

export interface ImportRow {
  lineNumber: number;
  sku: string;
  name: string;
  price: number;
  stock: number;
  category?: string;
  valid: boolean;
  errors: string[];
}

export interface ImportJob {
  id: string;
  merchantId: string;
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  rows: ImportRow[];
  status: ImportStatus;
  createdAt: string;
  completedAt?: string;
}

export class MerchantCatalogImportService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<ImportJob[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  private validateRow(row: Partial<ImportRow>, seenSkus: Set<string>): string[] {
    const errors: string[] = [];
    if (!row.sku || row.sku.length === 0) errors.push('SKU vacio');
    else if (row.sku.length > 50) errors.push('SKU excede 50 caracteres');
    else if (seenSkus.has(row.sku)) errors.push('SKU duplicado');
    if (!row.name || row.name.length === 0) errors.push('Nombre vacio');
    else if (row.name.length > 150) errors.push('Nombre excede 150 caracteres');
    if (row.price === undefined || row.price < 0) errors.push('Precio invalido');
    if (row.stock === undefined || row.stock < 0) errors.push('Stock invalido');
    return errors;
  }

  async parseAndValidate(input: {
    merchantId: string;
    filename: string;
    rows: { sku: string; name: string; price: number; stock: number; category?: string }[];
  }): Promise<ImportJob> {
    if (input.filename.length > 200) throw new Error('Nombre de archivo excede 200 caracteres');
    if (input.rows.length === 0) throw new Error('Archivo sin filas');
    if (input.rows.length > 10000) throw new Error('Maximo 10.000 filas por import');
    const seenSkus = new Set<string>();
    const parsedRows: ImportRow[] = input.rows.map((r, i) => {
      const errors = this.validateRow(r, seenSkus);
      if (errors.length === 0) seenSkus.add(r.sku);
      return {
        lineNumber: i + 1,
        sku: r.sku,
        name: r.name,
        price: r.price,
        stock: r.stock,
        category: r.category,
        valid: errors.length === 0,
        errors,
      };
    });
    const validRows = parsedRows.filter(r => r.valid).length;
    const job: ImportJob = {
      id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      filename: input.filename,
      totalRows: parsedRows.length,
      validRows,
      invalidRows: parsedRows.length - validRows,
      importedRows: 0,
      rows: parsedRows,
      status: 'VALIDATED',
      createdAt: new Date().toISOString(),
    };
    const list = await this.list(input.merchantId);
    list.push(job);
    if (list.length > 50) list.splice(0, list.length - 50);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('import parsed', { id: job.id, valid: validRows, invalid: job.invalidRows });
    return job;
  }

  async commit(merchantId: string, id: string, skipInvalid = true): Promise<ImportJob | null> {
    const list = await this.list(merchantId);
    const job = list.find(j => j.id === id);
    if (!job) return null;
    if (job.status !== 'VALIDATED') throw new Error('Job no esta validado');
    if (!skipInvalid && job.invalidRows > 0) {
      throw new Error(`No se puede importar con ${job.invalidRows} filas invalidas`);
    }
    job.status = 'IMPORTING';
    job.importedRows = job.validRows;
    job.status = 'COMPLETED';
    job.completedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    log.info('import committed', { id: job.id, imported: job.importedRows });
    return job;
  }

  async markFailed(merchantId: string, id: string, _reason: string): Promise<ImportJob | null> {
    const list = await this.list(merchantId);
    const job = list.find(j => j.id === id);
    if (!job) return null;
    if (job.status === 'COMPLETED') throw new Error('No se puede fallar job completado');
    job.status = 'FAILED';
    job.completedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return job;
  }

  async getErrors(merchantId: string, id: string): Promise<ImportRow[] | null> {
    const list = await this.list(merchantId);
    const job = list.find(j => j.id === id);
    if (!job) return null;
    return job.rows.filter(r => !r.valid);
  }

  async getRecent(merchantId: string, limit = 10): Promise<ImportJob[]> {
    const list = await this.list(merchantId);
    return [...list]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

export const merchantCatalogImport = new MerchantCatalogImportService();
