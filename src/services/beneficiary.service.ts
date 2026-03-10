import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('beneficiaries');

// ─── Types ──────────────────────────────────────────────

export interface Beneficiary {
  id: string;
  userId: string;
  name: string;
  phone: string;
  alias: string | null;          // e.g., "Mamá", "Socio"
  defaultAmount: number | null;  // preset amount for quick pay
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateBeneficiaryInput {
  userId: string;
  name: string;
  phone: string;
  alias?: string;
  defaultAmount?: number;
}

const BENE_PREFIX = 'beneficiaries:';
const BENE_TTL = 365 * 24 * 60 * 60;
const MAX_BENEFICIARIES = 30;

// ─── Service ────────────────────────────────────────────

export class BeneficiaryService {
  /**
   * Add a new beneficiary.
   */
  async addBeneficiary(input: CreateBeneficiaryInput): Promise<Beneficiary> {
    if (!input.name || input.name.length > 50) {
      throw new Error('Nombre debe tener entre 1 y 50 caracteres');
    }
    if (!input.phone || !/^\+?\d{8,15}$/.test(input.phone.replace(/\s/g, ''))) {
      throw new Error('Número de teléfono inválido');
    }
    if (input.alias && input.alias.length > 20) {
      throw new Error('Alias debe tener máximo 20 caracteres');
    }
    if (input.defaultAmount != null && (input.defaultAmount < 100 || input.defaultAmount > 50_000_000)) {
      throw new Error('Monto por defecto debe estar entre $100 y $50.000.000');
    }

    const existing = await this.getBeneficiaries(input.userId);
    if (existing.length >= MAX_BENEFICIARIES) {
      throw new Error(`Máximo ${MAX_BENEFICIARIES} beneficiarios`);
    }

    // Prevent duplicate phone
    const normalizedPhone = input.phone.replace(/\s/g, '');
    if (existing.some((b) => b.phone.replace(/\s/g, '') === normalizedPhone)) {
      throw new Error('Este beneficiario ya existe');
    }

    const beneficiary: Beneficiary = {
      id: `ben_${randomBytes(8).toString('hex')}`,
      userId: input.userId,
      name: input.name,
      phone: normalizedPhone,
      alias: input.alias ?? null,
      defaultAmount: input.defaultAmount ?? null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    };

    const all = [...existing, beneficiary];
    await this.save(input.userId, all);

    log.info('Beneficiary added', { userId: input.userId, beneficiaryId: beneficiary.id });
    return beneficiary;
  }

  /**
   * Get all beneficiaries for a user.
   */
  async getBeneficiaries(userId: string): Promise<Beneficiary[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${BENE_PREFIX}${userId}`);
      if (!raw) return [];
      return JSON.parse(raw) as Beneficiary[];
    } catch {
      return [];
    }
  }

  /**
   * Remove a beneficiary.
   */
  async removeBeneficiary(userId: string, beneficiaryId: string): Promise<boolean> {
    const all = await this.getBeneficiaries(userId);
    const filtered = all.filter((b) => b.id !== beneficiaryId);
    if (filtered.length === all.length) return false;

    await this.save(userId, filtered);
    log.info('Beneficiary removed', { userId, beneficiaryId });
    return true;
  }

  /**
   * Update a beneficiary.
   */
  async updateBeneficiary(
    userId: string,
    beneficiaryId: string,
    updates: Partial<Pick<Beneficiary, 'name' | 'alias' | 'defaultAmount'>>,
  ): Promise<Beneficiary | null> {
    const all = await this.getBeneficiaries(userId);
    const bene = all.find((b) => b.id === beneficiaryId);
    if (!bene) return null;

    if (updates.name != null) {
      if (!updates.name || updates.name.length > 50) throw new Error('Nombre inválido');
      bene.name = updates.name;
    }
    if (updates.alias !== undefined) {
      if (updates.alias && updates.alias.length > 20) throw new Error('Alias demasiado largo');
      bene.alias = updates.alias;
    }
    if (updates.defaultAmount !== undefined) {
      if (updates.defaultAmount != null && (updates.defaultAmount < 100 || updates.defaultAmount > 50_000_000)) {
        throw new Error('Monto fuera de rango');
      }
      bene.defaultAmount = updates.defaultAmount;
    }

    await this.save(userId, all);
    return bene;
  }

  /**
   * Record usage (update lastUsedAt for sorting).
   */
  async recordUsage(userId: string, beneficiaryId: string): Promise<void> {
    const all = await this.getBeneficiaries(userId);
    const bene = all.find((b) => b.id === beneficiaryId);
    if (!bene) return;

    bene.lastUsedAt = new Date().toISOString();
    await this.save(userId, all);
  }

  /**
   * Find beneficiary by phone number.
   */
  async findByPhone(userId: string, phone: string): Promise<Beneficiary | null> {
    const all = await this.getBeneficiaries(userId);
    const normalized = phone.replace(/\s/g, '');
    return all.find((b) => b.phone === normalized || b.phone.endsWith(normalized.slice(-8))) ?? null;
  }

  // ─── Helpers ────────────────────────────────────────────

  private async save(userId: string, beneficiaries: Beneficiary[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${BENE_PREFIX}${userId}`, JSON.stringify(beneficiaries), { EX: BENE_TTL });
    } catch (err) {
      log.warn('Failed to save beneficiaries', { userId, error: (err as Error).message });
    }
  }
}

export const beneficiaries = new BeneficiaryService();
