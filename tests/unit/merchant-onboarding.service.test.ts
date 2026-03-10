/**
 * Unit tests for MerchantOnboardingService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
  }),
}));

import { MerchantOnboardingService } from '../../src/services/merchant-onboarding.service';
import type { MerchantApplication } from '../../src/services/merchant-onboarding.service';

describe('MerchantOnboardingService', () => {
  let svc: MerchantOnboardingService;

  beforeEach(() => {
    svc = new MerchantOnboardingService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisLPush.mockResolvedValue(1);
    mockRedisLRange.mockResolvedValue([]);
  });

  const validInput = {
    userId: 'uid-1',
    businessName: 'Café del Barrio',
    businessType: 'individual' as const,
    rut: '12345678-9',
    contactEmail: 'cafe@example.com',
    contactPhone: '+56912345678',
    category: 'food',
    description: 'Cafetería artesanal en Providencia',
  };

  // ─── apply ─────────────────────────────────────────────

  describe('apply', () => {
    it('creates application with mapp_ prefix', async () => {
      const app = await svc.apply(validInput);
      expect(app.id).toMatch(/^mapp_[0-9a-f]{16}$/);
      expect(app.businessName).toBe('Café del Barrio');
      expect(app.status).toBe('pending');
      expect(app.approvedAt).toBeNull();
      expect(app.reviewNotes).toBeNull();
    });

    it('stores in Redis and adds to review queue', async () => {
      await svc.apply(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^merchant:app:mapp_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
      expect(mockRedisLPush).toHaveBeenCalledWith('merchant:review_queue', expect.stringMatching(/^mapp_/));
    });

    it('stores user → app mapping', async () => {
      await svc.apply(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'merchant:user:uid-1',
        expect.stringMatching(/^mapp_/),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('rejects empty business name', async () => {
      await expect(svc.apply({ ...validInput, businessName: '' }))
        .rejects.toThrow('Nombre del negocio');
    });

    it('rejects business name over 100 chars', async () => {
      await expect(svc.apply({ ...validInput, businessName: 'x'.repeat(101) }))
        .rejects.toThrow('Nombre del negocio');
    });

    it('rejects invalid business type', async () => {
      await expect(svc.apply({ ...validInput, businessType: 'corp' as never }))
        .rejects.toThrow('Tipo de negocio inválido');
    });

    it('rejects invalid RUT format', async () => {
      await expect(svc.apply({ ...validInput, rut: '123' }))
        .rejects.toThrow('RUT inválido');
    });

    it('accepts valid RUT with K', async () => {
      const app = await svc.apply({ ...validInput, rut: '1234567-K' });
      expect(app.rut).toBe('1234567-K');
    });

    it('rejects invalid email', async () => {
      await expect(svc.apply({ ...validInput, contactEmail: 'notanemail' }))
        .rejects.toThrow('Email inválido');
    });

    it('rejects invalid phone', async () => {
      await expect(svc.apply({ ...validInput, contactPhone: '123' }))
        .rejects.toThrow('Teléfono inválido');
    });

    it('rejects invalid category', async () => {
      await expect(svc.apply({ ...validInput, category: 'weapons' }))
        .rejects.toThrow('Categoría inválida');
    });

    it('rejects empty description', async () => {
      await expect(svc.apply({ ...validInput, description: '' }))
        .rejects.toThrow('Descripción debe tener');
    });

    it('rejects description over 500 chars', async () => {
      await expect(svc.apply({ ...validInput, description: 'x'.repeat(501) }))
        .rejects.toThrow('Descripción debe tener');
    });

    it('rejects duplicate application (pending)', async () => {
      // getUserApplication returns existing app ID, then getApplication returns app
      mockRedisGet
        .mockResolvedValueOnce('mapp_existing')  // user → app mapping
        .mockResolvedValueOnce(JSON.stringify({   // the app itself
          id: 'mapp_existing', status: 'pending',
        }));

      await expect(svc.apply(validInput)).rejects.toThrow('Ya tienes una solicitud');
    });

    it('allows reapplication after rejection', async () => {
      mockRedisGet
        .mockResolvedValueOnce('mapp_old')
        .mockResolvedValueOnce(JSON.stringify({ id: 'mapp_old', status: 'rejected' }));

      const app = await svc.apply(validInput);
      expect(app.id).toBeDefined();
    });

    it('normalizes phone', async () => {
      const app = await svc.apply({ ...validInput, contactPhone: '+569 1234 5678' });
      expect(app.contactPhone).toBe('+56912345678');
    });
  });

  // ─── getApplication ────────────────────────────────────

  describe('getApplication', () => {
    it('returns application by ID', async () => {
      const stored: MerchantApplication = {
        id: 'mapp_abc', userId: 'uid-1', businessName: 'Test', businessType: 'individual',
        rut: '12345678-9', contactEmail: 'a@b.com', contactPhone: '+569',
        category: 'food', description: 'test', status: 'pending',
        reviewNotes: null, approvedAt: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const app = await svc.getApplication('mapp_abc');
      expect(app).not.toBeNull();
      expect(app!.businessName).toBe('Test');
    });

    it('returns null for unknown ID', async () => {
      const app = await svc.getApplication('mapp_unknown');
      expect(app).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const app = await svc.getApplication('mapp_abc');
      expect(app).toBeNull();
    });
  });

  // ─── getUserApplication ────────────────────────────────

  describe('getUserApplication', () => {
    it('returns application for user', async () => {
      const stored: MerchantApplication = {
        id: 'mapp_abc', userId: 'uid-1', businessName: 'Test', businessType: 'individual',
        rut: '12345678-9', contactEmail: 'a@b.com', contactPhone: '+569',
        category: 'food', description: 'test', status: 'approved',
        reviewNotes: null, approvedAt: '2026-01-01',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet
        .mockResolvedValueOnce('mapp_abc')           // user → app mapping
        .mockResolvedValueOnce(JSON.stringify(stored)); // app data

      const app = await svc.getUserApplication('uid-1');
      expect(app).not.toBeNull();
      expect(app!.status).toBe('approved');
    });

    it('returns null when no application', async () => {
      const app = await svc.getUserApplication('uid-unknown');
      expect(app).toBeNull();
    });
  });

  // ─── review ────────────────────────────────────────────

  describe('review', () => {
    const pendingApp: MerchantApplication = {
      id: 'mapp_1', userId: 'uid-1', businessName: 'Test', businessType: 'company',
      rut: '12345678-9', contactEmail: 'a@b.com', contactPhone: '+569',
      category: 'retail', description: 'test', status: 'pending',
      reviewNotes: null, approvedAt: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('approves application with timestamp', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(pendingApp));

      const result = await svc.review('mapp_1', 'approved', 'Todo en orden');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.approvedAt).not.toBeNull();
      expect(result!.reviewNotes).toBe('Todo en orden');
    });

    it('rejects application with notes', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(pendingApp));

      const result = await svc.review('mapp_1', 'rejected', 'Documentos incompletos');
      expect(result!.status).toBe('rejected');
      expect(result!.reviewNotes).toBe('Documentos incompletos');
      expect(result!.approvedAt).toBeNull();
    });

    it('returns null for unknown application', async () => {
      const result = await svc.review('mapp_unknown', 'approved');
      expect(result).toBeNull();
    });

    it('returns null for already approved application', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...pendingApp, status: 'approved' }));
      const result = await svc.review('mapp_1', 'rejected');
      expect(result).toBeNull();
    });
  });

  // ─── getReviewQueue ────────────────────────────────────

  describe('getReviewQueue', () => {
    it('returns pending applications', async () => {
      const app: MerchantApplication = {
        id: 'mapp_1', userId: 'uid-1', businessName: 'Test', businessType: 'individual',
        rut: '12345678-9', contactEmail: 'a@b.com', contactPhone: '+569',
        category: 'food', description: 'test', status: 'pending',
        reviewNotes: null, approvedAt: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisLRange.mockResolvedValue(['mapp_1']);
      mockRedisGet.mockResolvedValue(JSON.stringify(app));

      const queue = await svc.getReviewQueue();
      expect(queue).toHaveLength(1);
    });

    it('filters out non-pending applications', async () => {
      const app: MerchantApplication = {
        id: 'mapp_1', userId: 'uid-1', businessName: 'Test', businessType: 'individual',
        rut: '12345678-9', contactEmail: 'a@b.com', contactPhone: '+569',
        category: 'food', description: 'test', status: 'approved',
        reviewNotes: null, approvedAt: '2026-01-01',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisLRange.mockResolvedValue(['mapp_1']);
      mockRedisGet.mockResolvedValue(JSON.stringify(app));

      const queue = await svc.getReviewQueue();
      expect(queue).toHaveLength(0);
    });

    it('returns empty on Redis error', async () => {
      mockRedisLRange.mockRejectedValue(new Error('Redis down'));
      const queue = await svc.getReviewQueue();
      expect(queue).toEqual([]);
    });
  });

  // ─── suspend ───────────────────────────────────────────

  describe('suspend', () => {
    it('suspends an approved merchant', async () => {
      const app: MerchantApplication = {
        id: 'mapp_1', userId: 'uid-1', businessName: 'Test', businessType: 'company',
        rut: '12345678-9', contactEmail: 'a@b.com', contactPhone: '+569',
        category: 'retail', description: 'test', status: 'approved',
        reviewNotes: null, approvedAt: '2026-01-01',
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(app));

      const result = await svc.suspend('mapp_1', 'Actividad sospechosa');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('suspended');
      expect(result!.reviewNotes).toBe('Actividad sospechosa');
    });

    it('returns null for non-approved merchant', async () => {
      const app = { id: 'mapp_1', status: 'pending' };
      mockRedisGet.mockResolvedValue(JSON.stringify(app));

      const result = await svc.suspend('mapp_1', 'reason');
      expect(result).toBeNull();
    });

    it('returns null for unknown application', async () => {
      const result = await svc.suspend('mapp_unknown', 'reason');
      expect(result).toBeNull();
    });
  });
});
