/**
 * UserVerificationService — email/phone verification codes.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { UserVerificationService } from '../../src/services/user-verification.service';

describe('UserVerificationService', () => {
  let service: UserVerificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserVerificationService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates verification', async () => {
    const result = await service.createVerification('u1', 'EMAIL', 'test@mail.cl');
    expect(result.id).toMatch(/^verif_/);
    expect(result.codeLength).toBe(6);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('rejects when in cooldown', async () => {
    mockRedisGet.mockResolvedValue('1');
    await expect(service.createVerification('u1', 'EMAIL', 'test@mail.cl'))
      .rejects.toThrow('Demasiados');
  });

  it('verifies correct code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'verif_1', userId: 'u1', type: 'EMAIL', code: '123456',
      attempts: 0, status: 'PENDING',
    }));
    const result = await service.verify('verif_1', '123456');
    expect(result.success).toBe(true);
  });

  it('rejects wrong code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'verif_1', userId: 'u1', type: 'EMAIL', code: '123456',
      attempts: 0, status: 'PENDING',
    }));
    const result = await service.verify('verif_1', '000000');
    expect(result.success).toBe(false);
    expect(result.error).toContain('incorrecto');
    expect(result.error).toContain('2 intentos');
  });

  it('locks after 3 failed attempts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'verif_1', userId: 'u1', type: 'EMAIL', code: '123456',
      attempts: 2, status: 'PENDING',
    }));
    const result = await service.verify('verif_1', '000000');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Máximo');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('FAILED');
  });

  it('rejects expired/missing verification', async () => {
    const result = await service.verify('verif_nope', '123456');
    expect(result.success).toBe(false);
    expect(result.error).toContain('no encontrada');
  });

  it('rejects already processed verification', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'verif_1', status: 'VERIFIED',
    }));
    const result = await service.verify('verif_1', '123456');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ya procesada');
  });

  it('checks verified status', async () => {
    mockRedisGet.mockResolvedValue('true');
    expect(await service.isVerified('u1', 'EMAIL')).toBe(true);
  });

  it('returns false for unverified', async () => {
    expect(await service.isVerified('u1', 'EMAIL')).toBe(false);
  });
});
