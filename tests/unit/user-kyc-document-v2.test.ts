const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserKYCDocumentService } from '../../src/services/user-kyc-document.service';

describe('UserKYCDocumentService', () => {
  let s: UserKYCDocumentService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserKYCDocumentService(); mockRedisGet.mockResolvedValue(null); });

  it('uploads document', async () => { const d = await s.uploadDocument({ userId: 'u1', type: 'CEDULA_FRENTE', fileUrl: 'https://storage/img.jpg', fileHash: 'abc123' }); expect(d.id).toMatch(/^kycdoc_/); expect(d.status).toBe('PENDING'); });
  it('rejects duplicate pending', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ type: 'CEDULA_FRENTE', status: 'PENDING' }])); await expect(s.uploadDocument({ userId: 'u1', type: 'CEDULA_FRENTE', fileUrl: 'x', fileHash: 'x' })).rejects.toThrow('Ya existe'); });
  it('allows re-upload after rejection', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ type: 'CEDULA_FRENTE', status: 'REJECTED' }])); const d = await s.uploadDocument({ userId: 'u1', type: 'CEDULA_FRENTE', fileUrl: 'x', fileHash: 'x' }); expect(d.status).toBe('PENDING'); });
  it('approves document', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'kycdoc_1', status: 'PENDING' }])); expect(await s.approveDocument('u1', 'kycdoc_1', 'admin')).toBe(true); const saved = JSON.parse(mockRedisSet.mock.calls[0][1]); expect(saved[0].status).toBe('APPROVED'); });
  it('rejects document', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'kycdoc_1', status: 'PENDING' }])); expect(await s.rejectDocument('u1', 'kycdoc_1', 'admin', 'Imagen borrosa')).toBe(true); const saved = JSON.parse(mockRedisSet.mock.calls[0][1]); expect(saved[0].rejectionReason).toBe('Imagen borrosa'); });
  it('calculates KYC progress', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ status: 'APPROVED' }, { status: 'APPROVED' }, { status: 'APPROVED' }, { status: 'PENDING' }])); const p = await s.getKYCProgress('u1'); expect(p.approved).toBe(3); expect(p.complete).toBe(true); });
  it('returns incomplete when < 3 approved', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ status: 'APPROVED' }, { status: 'PENDING' }])); const p = await s.getKYCProgress('u1'); expect(p.complete).toBe(false); });
});
