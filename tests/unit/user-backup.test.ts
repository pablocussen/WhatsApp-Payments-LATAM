const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserBackupService } from '../../src/services/user-backup.service';

describe('UserBackupService', () => {
  let s: UserBackupService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserBackupService(); mockRedisGet.mockResolvedValue(null); });

  it('creates backup', async () => { const b = await s.createBackup('u1'); expect(b.id).toMatch(/^bkp_/); expect(b.status).toBe('CREATING'); expect(b.encryptionKey).toHaveLength(32); expect(b.sections).toContain('profile'); });
  it('creates auto backup', async () => { const b = await s.createBackup('u1', 'AUTO'); expect(b.type).toBe('AUTO'); });
  it('returns null for missing', async () => { expect(await s.getBackup('nope')).toBeNull(); });
  it('returns latest ID', async () => { mockRedisGet.mockResolvedValue('bkp_123'); expect(await s.getLatestBackupId('u1')).toBe('bkp_123'); });
  it('marks ready', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'bkp_1', status: 'CREATING' }));
    expect(await s.markReady('bkp_1', 2048)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('READY'); expect(saved.sizeBytes).toBe(2048);
  });
});
