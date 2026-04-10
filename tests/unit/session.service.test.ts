/**
 * SessionService — user session management.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    multi: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(),
      lPush: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([null, null]),
    }),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { SessionService } from '../../src/services/session.service';

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService();
    mockRedisGet.mockResolvedValue(null);
    mockRedisLRange.mockResolvedValue([]);
  });

  // ── createSession ─────────────────────────────────

  it('creates a session', async () => {
    const s = await service.createSession({
      userId: 'u1', deviceType: 'WHATSAPP', deviceInfo: 'iPhone 15', ipAddress: '1.2.3.4',
    });
    expect(s.id).toMatch(/^sess_/);
    expect(s.userId).toBe('u1');
    expect(s.deviceType).toBe('WHATSAPP');
    expect(s.active).toBe(true);
  });

  // ── getSession ────────────────────────────────────

  it('returns null for missing session', async () => {
    expect(await service.getSession('sess_unknown')).toBeNull();
  });

  it('returns stored session', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sess_1', userId: 'u1', active: true }));
    const s = await service.getSession('sess_1');
    expect(s?.userId).toBe('u1');
  });

  // ── getUserSessions ───────────────────────────────

  it('returns empty for new user', async () => {
    expect(await service.getUserSessions('u1')).toEqual([]);
  });

  it('returns user sessions', async () => {
    mockRedisLRange.mockResolvedValue(['sess_1', 'sess_2']);
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_1', userId: 'u1', active: true }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_2', userId: 'u1', active: true }));
    const sessions = await service.getUserSessions('u1');
    expect(sessions).toHaveLength(2);
  });

  // ── touchSession ──────────────────────────────────

  it('updates lastActiveAt', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'sess_1', userId: 'u1', active: true, lastActiveAt: '2026-04-01',
    }));
    const result = await service.touchSession('sess_1');
    expect(result).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.lastActiveAt).not.toBe('2026-04-01');
  });

  it('returns false for inactive session', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sess_1', active: false }));
    expect(await service.touchSession('sess_1')).toBe(false);
  });

  it('returns false for missing session', async () => {
    expect(await service.touchSession('sess_unknown')).toBe(false);
  });

  // ── revokeSession ─────────────────────────────────

  it('revokes a session', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sess_1', userId: 'u1', active: true }));
    const result = await service.revokeSession('u1', 'sess_1');
    expect(result).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.active).toBe(false);
  });

  it('rejects revoking other users session', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sess_1', userId: 'u2', active: true }));
    expect(await service.revokeSession('u1', 'sess_1')).toBe(false);
  });

  // ── revokeAllSessions ─────────────────────────────

  it('revokes all active sessions', async () => {
    mockRedisLRange.mockResolvedValue(['sess_1', 'sess_2']);
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_1', userId: 'u1', active: true }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_2', userId: 'u1', active: true }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_1', userId: 'u1', active: true }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_2', userId: 'u1', active: true }));
    const count = await service.revokeAllSessions('u1');
    expect(count).toBe(2);
  });

  // ── countActiveSessions ───────────────────────────

  it('counts active sessions', async () => {
    mockRedisLRange.mockResolvedValue(['sess_1', 'sess_2', 'sess_3']);
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_1', active: true }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_2', active: false }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'sess_3', active: true }));
    expect(await service.countActiveSessions('u1')).toBe(2);
  });
});
