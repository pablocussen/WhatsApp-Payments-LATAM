const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserExportDataService } from '../../src/services/user-export-data.service';

describe('UserExportDataService', () => {
  let s: UserExportDataService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserExportDataService(); mockRedisGet.mockResolvedValue(null); });

  it('requests export', async () => { const e = await s.requestExport('u1', ['profile', 'transactions']); expect(e.id).toMatch(/^uexp_/); expect(e.status).toBe('PENDING'); expect(e.sections).toHaveLength(2); });
  it('rejects empty sections', async () => { await expect(s.requestExport('u1', [])).rejects.toThrow('al menos una'); });
  it('rejects invalid section', async () => { await expect(s.requestExport('u1', ['invalid'])).rejects.toThrow('invalida'); });
  it('rejects cooldown', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ status: 'READY', requestedAt: new Date().toISOString() }));
    await expect(s.requestExport('u1', ['profile'])).rejects.toThrow('24 horas');
  });
  it('returns null for missing', async () => { expect(await s.getExport('nope')).toBeNull(); });
  it('marks ready', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'uexp_1', status: 'PROCESSING' }));
    expect(await s.markReady('uexp_1', 1024, 'https://storage/file.json')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('READY'); expect(saved.fileSize).toBe(1024);
  });
  it('lists valid sections', () => { expect(s.getValidSections()).toContain('transactions'); expect(s.getValidSections()).toHaveLength(7); });
});
