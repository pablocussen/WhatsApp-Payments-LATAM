import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('tx-category');

const CAT_PREFIX = 'txcat:';
const CAT_TTL = 365 * 24 * 60 * 60;

export type CategoryType =
  | 'FOOD' | 'TRANSPORT' | 'ENTERTAINMENT' | 'SHOPPING'
  | 'SERVICES' | 'HEALTH' | 'EDUCATION' | 'BILLS'
  | 'TRANSFER' | 'OTHER';

export const CATEGORY_LABELS: Record<CategoryType, { es: string; en: string; icon: string }> = {
  FOOD: { es: 'Comida', en: 'Food', icon: '🍔' },
  TRANSPORT: { es: 'Transporte', en: 'Transport', icon: '🚗' },
  ENTERTAINMENT: { es: 'Entretencion', en: 'Entertainment', icon: '🎬' },
  SHOPPING: { es: 'Compras', en: 'Shopping', icon: '🛍️' },
  SERVICES: { es: 'Servicios', en: 'Services', icon: '🔧' },
  HEALTH: { es: 'Salud', en: 'Health', icon: '🏥' },
  EDUCATION: { es: 'Educacion', en: 'Education', icon: '📚' },
  BILLS: { es: 'Cuentas', en: 'Bills', icon: '📄' },
  TRANSFER: { es: 'Transferencia', en: 'Transfer', icon: '💸' },
  OTHER: { es: 'Otro', en: 'Other', icon: '📦' },
};

// Keyword-based auto-categorization
const KEYWORDS: [string[], CategoryType][] = [
  [['almuerzo', 'cena', 'comida', 'restaurant', 'cafe', 'pizza', 'sushi', 'menu', 'colacion'], 'FOOD'],
  [['uber', 'taxi', 'metro', 'bus', 'bencina', 'estacionamiento', 'peaje', 'micro'], 'TRANSPORT'],
  [['netflix', 'spotify', 'cine', 'teatro', 'juego', 'bar', 'concierto', 'fiesta'], 'ENTERTAINMENT'],
  [['tienda', 'ropa', 'zapatos', 'mercado', 'supermercado', 'feria', 'compra'], 'SHOPPING'],
  [['electricidad', 'agua', 'gas', 'internet', 'telefono', 'luz', 'arriendo', 'dividendo'], 'BILLS'],
  [['doctor', 'farmacia', 'clinica', 'hospital', 'dentista', 'examen', 'consulta'], 'HEALTH'],
  [['universidad', 'colegio', 'curso', 'libro', 'matricula', 'mensualidad'], 'EDUCATION'],
  [['reparacion', 'plomero', 'electricista', 'servicio', 'mantencion'], 'SERVICES'],
];

export interface TransactionCategorization {
  transactionRef: string;
  category: CategoryType;
  confidence: 'AUTO' | 'MANUAL';
  updatedAt: string;
}

export class TransactionCategoryService {
  /**
   * Auto-categorize a transaction based on description keywords.
   */
  autoCategorizeTx(description: string): { category: CategoryType; confidence: number } {
    if (!description) return { category: 'TRANSFER', confidence: 0.5 };

    const lower = description.toLowerCase();
    for (const [keywords, category] of KEYWORDS) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          return { category, confidence: 0.8 };
        }
      }
    }

    return { category: 'OTHER', confidence: 0.3 };
  }

  /**
   * Set category for a transaction (manual override).
   */
  async setCategoryManual(userId: string, transactionRef: string, category: CategoryType): Promise<TransactionCategorization> {
    if (!CATEGORY_LABELS[category]) {
      throw new Error('Categoria invalida.');
    }

    const entry: TransactionCategorization = {
      transactionRef,
      category,
      confidence: 'MANUAL',
      updatedAt: new Date().toISOString(),
    };

    const categories = await this.getUserCategories(userId);
    const idx = categories.findIndex(c => c.transactionRef === transactionRef);
    if (idx >= 0) {
      categories[idx] = entry;
    } else {
      categories.push(entry);
    }

    // Keep only last 500 categorizations
    const trimmed = categories.slice(-500);
    await this.saveUserCategories(userId, trimmed);

    return entry;
  }

  /**
   * Get category for a specific transaction.
   */
  async getCategory(userId: string, transactionRef: string): Promise<TransactionCategorization | null> {
    const categories = await this.getUserCategories(userId);
    return categories.find(c => c.transactionRef === transactionRef) ?? null;
  }

  /**
   * Get spending breakdown by category for a user.
   */
  async getSpendingByCategory(userId: string, amounts: { ref: string; amount: number; description: string }[]): Promise<Record<CategoryType, number>> {
    const categories = await this.getUserCategories(userId);
    const catMap = new Map(categories.map(c => [c.transactionRef, c.category]));

    const result: Record<CategoryType, number> = {} as Record<CategoryType, number>;
    for (const key of Object.keys(CATEGORY_LABELS) as CategoryType[]) {
      result[key] = 0;
    }

    for (const tx of amounts) {
      const cat = catMap.get(tx.ref) ?? this.autoCategorizeTx(tx.description).category;
      result[cat] += tx.amount;
    }

    return result;
  }

  /**
   * Get category label and icon.
   */
  getCategoryLabel(category: CategoryType, lang: 'es' | 'en' = 'es'): { label: string; icon: string } {
    const info = CATEGORY_LABELS[category] ?? CATEGORY_LABELS.OTHER;
    return { label: info[lang], icon: info.icon };
  }

  private async getUserCategories(userId: string): Promise<TransactionCategorization[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${CAT_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as TransactionCategorization[] : [];
    } catch {
      return [];
    }
  }

  private async saveUserCategories(userId: string, categories: TransactionCategorization[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${CAT_PREFIX}${userId}`, JSON.stringify(categories), { EX: CAT_TTL });
    } catch (err) {
      log.warn('Failed to save categories', { userId, error: (err as Error).message });
    }
  }
}

export const txCategories = new TransactionCategoryService();
