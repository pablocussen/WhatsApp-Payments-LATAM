/**
 * Unit tests for ContactsService.
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

import { ContactsService } from '../../src/services/contacts.service';

describe('ContactsService', () => {
  let svc: ContactsService;

  beforeEach(() => {
    svc = new ContactsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  // ─── getContacts ─────────────────────────────────────

  describe('getContacts', () => {
    it('returns empty array when no contacts stored', async () => {
      const result = await svc.getContacts('uid-1');
      expect(result).toEqual([]);
    });

    it('returns parsed contacts from Redis', async () => {
      const contacts = [
        { userId: 'u2', waId: '56922222222', name: 'Ana', addedAt: '2026-03-09' },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(contacts));

      const result = await svc.getContacts('uid-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Ana');
    });

    it('returns empty array on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getContacts('uid-1');
      expect(result).toEqual([]);
    });
  });

  // ─── addContact ──────────────────────────────────────

  describe('addContact', () => {
    it('adds a contact successfully', async () => {
      const result = await svc.addContact('uid-1', {
        userId: 'u2',
        waId: '56922222222',
        name: 'Ana',
      });
      expect(result.success).toBe(true);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'contacts:uid-1',
        expect.stringContaining('Ana'),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('rejects duplicate contact', async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify([{ userId: 'u2', waId: '56922222222', name: 'Ana', addedAt: '2026-01-01' }]),
      );

      const result = await svc.addContact('uid-1', {
        userId: 'u2',
        waId: '56922222222',
        name: 'Ana',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('ya está');
    });

    it('rejects when at max contacts (20)', async () => {
      const full = Array.from({ length: 20 }, (_, i) => ({
        userId: `u${i}`,
        waId: `569${String(i).padStart(8, '0')}`,
        name: `User ${i}`,
        addedAt: '2026-01-01',
      }));
      mockRedisGet.mockResolvedValue(JSON.stringify(full));

      const result = await svc.addContact('uid-1', {
        userId: 'u-new',
        waId: '56999999999',
        name: 'New',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('20');
    });

    it('stores alias when provided', async () => {
      await svc.addContact('uid-1', {
        userId: 'u2',
        waId: '56922222222',
        name: 'Ana García',
        alias: 'Anita',
      });

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored[0].alias).toBe('Anita');
    });
  });

  // ─── removeContact ───────────────────────────────────

  describe('removeContact', () => {
    it('removes existing contact', async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify([
          { userId: 'u2', waId: '56922222222', name: 'Ana', addedAt: '2026-01-01' },
          { userId: 'u3', waId: '56933333333', name: 'Pedro', addedAt: '2026-01-01' },
        ]),
      );

      const result = await svc.removeContact('uid-1', 'u2');
      expect(result).toBe(true);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Pedro');
    });

    it('returns false when contact not found', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.removeContact('uid-1', 'u-nonexistent');
      expect(result).toBe(false);
    });
  });

  // ─── findByPhone ─────────────────────────────────────

  describe('findByPhone', () => {
    const storedContacts = [
      { userId: 'u2', waId: '56922222222', name: 'Ana', addedAt: '2026-01-01' },
      { userId: 'u3', waId: '56933333333', name: 'Pedro', addedAt: '2026-01-01' },
    ];

    beforeEach(() => {
      mockRedisGet.mockResolvedValue(JSON.stringify(storedContacts));
    });

    it('finds contact by exact phone', async () => {
      const result = await svc.findByPhone('uid-1', '56922222222');
      expect(result?.name).toBe('Ana');
    });

    it('finds contact by suffix match', async () => {
      const result = await svc.findByPhone('uid-1', '922222222');
      expect(result?.name).toBe('Ana');
    });

    it('returns undefined when not found', async () => {
      const result = await svc.findByPhone('uid-1', '56999999999');
      expect(result).toBeUndefined();
    });

    it('strips formatting characters from phone', async () => {
      const result = await svc.findByPhone('uid-1', '+569-2222-2222');
      expect(result?.name).toBe('Ana');
    });
  });
});
