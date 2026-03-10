/**
 * Unit tests for BeneficiaryService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

import { BeneficiaryService } from '../../src/services/beneficiary.service';
import type { Beneficiary } from '../../src/services/beneficiary.service';

describe('BeneficiaryService', () => {
  let svc: BeneficiaryService;

  beforeEach(() => {
    svc = new BeneficiaryService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── addBeneficiary ────────────────────────────────────

  describe('addBeneficiary', () => {
    const validInput = {
      userId: 'uid-1',
      name: 'Juan Pérez',
      phone: '+56912345678',
    };

    it('creates beneficiary with ben_ prefix', async () => {
      const bene = await svc.addBeneficiary(validInput);
      expect(bene.id).toMatch(/^ben_[0-9a-f]{16}$/);
      expect(bene.name).toBe('Juan Pérez');
      expect(bene.phone).toBe('+56912345678');
      expect(bene.alias).toBeNull();
      expect(bene.defaultAmount).toBeNull();
      expect(bene.lastUsedAt).toBeNull();
    });

    it('sets optional alias and default amount', async () => {
      const bene = await svc.addBeneficiary({
        ...validInput, alias: 'Mamá', defaultAmount: 20000,
      });
      expect(bene.alias).toBe('Mamá');
      expect(bene.defaultAmount).toBe(20000);
    });

    it('normalizes phone (removes spaces)', async () => {
      const bene = await svc.addBeneficiary({
        ...validInput, phone: '+569 1234 5678',
      });
      expect(bene.phone).toBe('+56912345678');
    });

    it('rejects empty name', async () => {
      await expect(svc.addBeneficiary({ ...validInput, name: '' }))
        .rejects.toThrow('Nombre debe tener');
    });

    it('rejects name over 50 chars', async () => {
      await expect(svc.addBeneficiary({ ...validInput, name: 'x'.repeat(51) }))
        .rejects.toThrow('Nombre debe tener');
    });

    it('rejects invalid phone', async () => {
      await expect(svc.addBeneficiary({ ...validInput, phone: '123' }))
        .rejects.toThrow('Número de teléfono inválido');
    });

    it('rejects alias over 20 chars', async () => {
      await expect(svc.addBeneficiary({ ...validInput, alias: 'x'.repeat(21) }))
        .rejects.toThrow('Alias debe tener');
    });

    it('rejects default amount below 100', async () => {
      await expect(svc.addBeneficiary({ ...validInput, defaultAmount: 50 }))
        .rejects.toThrow('Monto por defecto');
    });

    it('rejects default amount above 50M', async () => {
      await expect(svc.addBeneficiary({ ...validInput, defaultAmount: 50_000_001 }))
        .rejects.toThrow('Monto por defecto');
    });

    it('rejects when max beneficiaries reached', async () => {
      const existing: Beneficiary[] = Array.from({ length: 30 }, (_, i) => ({
        id: `ben_${i}`, userId: 'uid-1', name: `Ben ${i}`, phone: `+569${String(i).padStart(8, '0')}`,
        alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01',
      }));
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      await expect(svc.addBeneficiary(validInput)).rejects.toThrow('Máximo 30');
    });

    it('rejects duplicate phone', async () => {
      const existing: Beneficiary[] = [{
        id: 'ben_old', userId: 'uid-1', name: 'Old', phone: '+56912345678',
        alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      await expect(svc.addBeneficiary(validInput)).rejects.toThrow('ya existe');
    });

    it('saves to Redis', async () => {
      await svc.addBeneficiary(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'beneficiaries:uid-1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });
  });

  // ─── getBeneficiaries ──────────────────────────────────

  describe('getBeneficiaries', () => {
    it('returns stored beneficiaries', async () => {
      const stored: Beneficiary[] = [{
        id: 'ben_1', userId: 'uid-1', name: 'Test', phone: '+56912345678',
        alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const result = await svc.getBeneficiaries('uid-1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      const result = await svc.getBeneficiaries('uid-1');
      expect(result).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getBeneficiaries('uid-1');
      expect(result).toEqual([]);
    });
  });

  // ─── removeBeneficiary ─────────────────────────────────

  describe('removeBeneficiary', () => {
    it('removes a beneficiary', async () => {
      const stored: Beneficiary[] = [
        { id: 'ben_1', userId: 'uid-1', name: 'A', phone: '+56911111111', alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01' },
        { id: 'ben_2', userId: 'uid-1', name: 'B', phone: '+56922222222', alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01' },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const result = await svc.removeBeneficiary('uid-1', 'ben_1');
      expect(result).toBe(true);
      const saved = JSON.parse(mockRedisSet.mock.calls[0][1]) as Beneficiary[];
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('ben_2');
    });

    it('returns false for unknown beneficiary', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.removeBeneficiary('uid-1', 'ben_unknown');
      expect(result).toBe(false);
    });
  });

  // ─── updateBeneficiary ─────────────────────────────────

  describe('updateBeneficiary', () => {
    const stored: Beneficiary[] = [{
      id: 'ben_1', userId: 'uid-1', name: 'Old Name', phone: '+56912345678',
      alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01',
    }];

    it('updates name', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateBeneficiary('uid-1', 'ben_1', { name: 'New Name' });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('New Name');
    });

    it('updates alias', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateBeneficiary('uid-1', 'ben_1', { alias: 'Amigo' });
      expect(result!.alias).toBe('Amigo');
    });

    it('updates default amount', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateBeneficiary('uid-1', 'ben_1', { defaultAmount: 15000 });
      expect(result!.defaultAmount).toBe(15000);
    });

    it('returns null for unknown beneficiary', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.updateBeneficiary('uid-1', 'ben_unknown', { name: 'X' });
      expect(result).toBeNull();
    });

    it('rejects invalid name', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      await expect(svc.updateBeneficiary('uid-1', 'ben_1', { name: '' }))
        .rejects.toThrow('Nombre inválido');
    });

    it('rejects long alias', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      await expect(svc.updateBeneficiary('uid-1', 'ben_1', { alias: 'x'.repeat(21) }))
        .rejects.toThrow('Alias demasiado largo');
    });
  });

  // ─── recordUsage ───────────────────────────────────────

  describe('recordUsage', () => {
    it('updates lastUsedAt', async () => {
      const stored: Beneficiary[] = [{
        id: 'ben_1', userId: 'uid-1', name: 'Test', phone: '+56912345678',
        alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      await svc.recordUsage('uid-1', 'ben_1');
      const saved = JSON.parse(mockRedisSet.mock.calls[0][1]) as Beneficiary[];
      expect(saved[0].lastUsedAt).not.toBeNull();
    });

    it('does nothing for unknown beneficiary', async () => {
      await svc.recordUsage('uid-1', 'ben_unknown');
      expect(mockRedisSet).not.toHaveBeenCalled();
    });
  });

  // ─── findByPhone ───────────────────────────────────────

  describe('findByPhone', () => {
    const stored: Beneficiary[] = [{
      id: 'ben_1', userId: 'uid-1', name: 'Juan', phone: '+56912345678',
      alias: null, defaultAmount: null, lastUsedAt: null, createdAt: '2026-01-01',
    }];

    it('finds by exact phone', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.findByPhone('uid-1', '+56912345678');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Juan');
    });

    it('finds by suffix match (last 8 digits)', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.findByPhone('uid-1', '12345678');
      expect(result).not.toBeNull();
    });

    it('returns null for no match', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.findByPhone('uid-1', '+56999999999');
      expect(result).toBeNull();
    });
  });
});
