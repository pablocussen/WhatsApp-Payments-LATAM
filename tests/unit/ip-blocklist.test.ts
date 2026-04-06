/**
 * IP blocklist middleware — auto-block abusive IPs.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);
const mockRedisDel = jest.fn().mockResolvedValue(1);
const mockRedisExpire = jest.fn().mockResolvedValue(true);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { recordStrike, ipBlocklist, isBlocked, unblockIp } from '../../src/middleware/ip-blocklist.middleware';
import { Request, Response } from 'express';

describe('IP Blocklist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
  });

  // ── recordStrike ���─────────────────────────────────

  describe('recordStrike', () => {
    it('increments strike counter', async () => {
      await recordStrike('10.0.0.1');
      expect(mockRedisIncr).toHaveBeenCalledWith('strikes:ip:10.0.0.1');
    });

    it('sets expiry on first strike', async () => {
      mockRedisIncr.mockResolvedValue(1);
      await recordStrike('10.0.0.1');
      expect(mockRedisExpire).toHaveBeenCalledWith('strikes:ip:10.0.0.1', 600);
    });

    it('does not set expiry on subsequent strikes', async () => {
      mockRedisIncr.mockResolvedValue(3);
      await recordStrike('10.0.0.1');
      expect(mockRedisExpire).not.toHaveBeenCalled();
    });

    it('blocks IP after 5 strikes', async () => {
      mockRedisIncr.mockResolvedValue(5);
      const blocked = await recordStrike('10.0.0.1');
      expect(blocked).toBe(true);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'blocklist:ip:10.0.0.1',
        expect.any(String),
        { EX: 3600 },
      );
      expect(mockRedisDel).toHaveBeenCalledWith('strikes:ip:10.0.0.1');
    });

    it('returns false below threshold', async () => {
      mockRedisIncr.mockResolvedValue(3);
      const blocked = await recordStrike('10.0.0.1');
      expect(blocked).toBe(false);
    });
  });

  // ── ipBlocklist middleware ─────────────────────────

  describe('ipBlocklist middleware', () => {
    it('allows non-blocked IPs', async () => {
      mockRedisGet.mockResolvedValue(null);
      const mw = ipBlocklist();
      const next = jest.fn();
      await mw({ ip: '10.0.0.1' } as Request, {} as Response, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks blocked IPs with 403', async () => {
      mockRedisGet.mockResolvedValue('2026-04-01T00:00:00Z');
      const mw = ipBlocklist();
      const next = jest.fn();
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      } as unknown as Response;

      await mw({ ip: '10.0.0.1' } as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── isBlocked ─────────────────────────────────────

  describe('isBlocked', () => {
    it('returns true for blocked IP', async () => {
      mockRedisGet.mockResolvedValue('2026-04-01');
      expect(await isBlocked('10.0.0.1')).toBe(true);
    });

    it('returns false for non-blocked IP', async () => {
      mockRedisGet.mockResolvedValue(null);
      expect(await isBlocked('10.0.0.1')).toBe(false);
    });
  });

  // ── unblockIp ────────────────────��────────────────

  describe('unblockIp', () => {
    it('removes block and returns true', async () => {
      mockRedisDel.mockResolvedValue(1);
      expect(await unblockIp('10.0.0.1')).toBe(true);
      expect(mockRedisDel).toHaveBeenCalledWith('blocklist:ip:10.0.0.1');
    });

    it('returns false if IP was not blocked', async () => {
      mockRedisDel.mockResolvedValue(0);
      expect(await unblockIp('10.0.0.2')).toBe(false);
    });
  });
});
