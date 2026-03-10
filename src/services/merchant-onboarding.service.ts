import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-onboarding');

// ─── Types ──────────────────────────────────────────────

export type MerchantStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'suspended';
export type BusinessType = 'individual' | 'company' | 'nonprofit';

export interface MerchantApplication {
  id: string;
  userId: string;
  businessName: string;
  businessType: BusinessType;
  rut: string;
  contactEmail: string;
  contactPhone: string;
  category: string;
  description: string;
  status: MerchantStatus;
  reviewNotes: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApplicationInput {
  userId: string;
  businessName: string;
  businessType: BusinessType;
  rut: string;
  contactEmail: string;
  contactPhone: string;
  category: string;
  description: string;
}

const APP_PREFIX = 'merchant:app:';
const USER_APP_PREFIX = 'merchant:user:';
const QUEUE_KEY = 'merchant:review_queue';
const APP_TTL = 365 * 24 * 60 * 60;

const VALID_CATEGORIES = [
  'food', 'retail', 'services', 'technology', 'health',
  'education', 'transport', 'entertainment', 'other',
];

// ─── Service ────────────────────────────────────────────

export class MerchantOnboardingService {
  /**
   * Submit a merchant application.
   */
  async apply(input: CreateApplicationInput): Promise<MerchantApplication> {
    if (!input.businessName || input.businessName.length > 100) {
      throw new Error('Nombre del negocio debe tener entre 1 y 100 caracteres');
    }
    if (!['individual', 'company', 'nonprofit'].includes(input.businessType)) {
      throw new Error('Tipo de negocio inválido');
    }
    if (!input.rut || !/^\d{7,8}-[\dkK]$/.test(input.rut)) {
      throw new Error('RUT inválido (formato: 12345678-9)');
    }
    if (!input.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
      throw new Error('Email inválido');
    }
    if (!input.contactPhone || !/^\+?\d{8,15}$/.test(input.contactPhone.replace(/\s/g, ''))) {
      throw new Error('Teléfono inválido');
    }
    if (!VALID_CATEGORIES.includes(input.category)) {
      throw new Error('Categoría inválida');
    }
    if (!input.description || input.description.length > 500) {
      throw new Error('Descripción debe tener entre 1 y 500 caracteres');
    }

    // Check for existing application
    const existing = await this.getUserApplication(input.userId);
    if (existing && existing.status !== 'rejected') {
      throw new Error('Ya tienes una solicitud en proceso');
    }

    const app: MerchantApplication = {
      id: `mapp_${randomBytes(8).toString('hex')}`,
      userId: input.userId,
      businessName: input.businessName,
      businessType: input.businessType,
      rut: input.rut,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone.replace(/\s/g, ''),
      category: input.category,
      description: input.description,
      status: 'pending',
      reviewNotes: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${APP_PREFIX}${app.id}`, JSON.stringify(app), { EX: APP_TTL });
      await redis.set(`${USER_APP_PREFIX}${input.userId}`, app.id, { EX: APP_TTL });
      // Add to review queue
      await redis.lPush(QUEUE_KEY, app.id);
    } catch (err) {
      log.warn('Failed to save application', { error: (err as Error).message });
    }

    log.info('Merchant application submitted', { appId: app.id, userId: input.userId, businessName: input.businessName });
    return app;
  }

  /**
   * Get application by ID.
   */
  async getApplication(appId: string): Promise<MerchantApplication | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${APP_PREFIX}${appId}`);
      if (!raw) return null;
      return JSON.parse(raw) as MerchantApplication;
    } catch {
      return null;
    }
  }

  /**
   * Get application by user ID.
   */
  async getUserApplication(userId: string): Promise<MerchantApplication | null> {
    try {
      const redis = getRedis();
      const appId = await redis.get(`${USER_APP_PREFIX}${userId}`);
      if (!appId) return null;
      return this.getApplication(appId);
    } catch {
      return null;
    }
  }

  /**
   * Review an application (admin action).
   */
  async review(appId: string, status: 'approved' | 'rejected', notes?: string): Promise<MerchantApplication | null> {
    const app = await this.getApplication(appId);
    if (!app) return null;
    if (app.status !== 'pending' && app.status !== 'under_review') return null;

    app.status = status;
    app.reviewNotes = notes ?? null;
    app.updatedAt = new Date().toISOString();
    if (status === 'approved') {
      app.approvedAt = new Date().toISOString();
    }

    try {
      const redis = getRedis();
      await redis.set(`${APP_PREFIX}${app.id}`, JSON.stringify(app), { EX: APP_TTL });
    } catch (err) {
      log.warn('Failed to update application', { appId, error: (err as Error).message });
    }

    log.info('Merchant application reviewed', { appId, status, notes });
    return app;
  }

  /**
   * Get pending applications (admin queue).
   */
  async getReviewQueue(limit = 20): Promise<MerchantApplication[]> {
    try {
      const redis = getRedis();
      const ids = await redis.lRange(QUEUE_KEY, 0, limit - 1);
      const apps: MerchantApplication[] = [];

      for (const id of ids) {
        const app = await this.getApplication(id);
        if (app && (app.status === 'pending' || app.status === 'under_review')) {
          apps.push(app);
        }
      }

      return apps;
    } catch {
      return [];
    }
  }

  /**
   * Suspend a merchant.
   */
  async suspend(appId: string, reason: string): Promise<MerchantApplication | null> {
    const app = await this.getApplication(appId);
    if (!app || app.status !== 'approved') return null;

    app.status = 'suspended';
    app.reviewNotes = reason;
    app.updatedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${APP_PREFIX}${app.id}`, JSON.stringify(app), { EX: APP_TTL });
    } catch (err) {
      log.warn('Failed to suspend merchant', { appId, error: (err as Error).message });
    }

    log.info('Merchant suspended', { appId, reason });
    return app;
  }
}

export const merchantOnboarding = new MerchantOnboardingService();
