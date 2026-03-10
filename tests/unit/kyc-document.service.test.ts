/**
 * Unit tests for KycDocumentService.
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

import { KycDocumentService } from '../../src/services/kyc-document.service';
import type { KycDocument, KycVerification } from '../../src/services/kyc-document.service';

describe('KycDocumentService', () => {
  let svc: KycDocumentService;

  beforeEach(() => {
    svc = new KycDocumentService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  const validUpload = {
    userId: 'u1',
    type: 'cedula_frontal' as const,
    fileName: 'cedula_front.jpg',
    mimeType: 'image/jpeg',
    fileSize: 500_000,
    storageUrl: 'gs://bucket/cedula_front.jpg',
  };

  // ─── uploadDocument ─────────────────────────────────────

  describe('uploadDocument', () => {
    it('creates document with doc_ prefix', async () => {
      const doc = await svc.uploadDocument(validUpload);
      expect(doc.id).toMatch(/^doc_[0-9a-f]{16}$/);
      expect(doc.userId).toBe('u1');
      expect(doc.type).toBe('cedula_frontal');
      expect(doc.status).toBe('pending');
      expect(doc.rejectionReason).toBeNull();
      expect(doc.reviewedBy).toBeNull();
    });

    it('saves to Redis', async () => {
      await svc.uploadDocument(validUpload);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^kyc:doc:doc_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('adds to user document list', async () => {
      await svc.uploadDocument(validUpload);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'kyc:user-docs:u1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('rejects empty userId', async () => {
      await expect(svc.uploadDocument({ ...validUpload, userId: '' }))
        .rejects.toThrow('userId');
    });

    it('rejects invalid document type', async () => {
      await expect(svc.uploadDocument({ ...validUpload, type: 'passport' as any }))
        .rejects.toThrow('inválido');
    });

    it('rejects empty fileName', async () => {
      await expect(svc.uploadDocument({ ...validUpload, fileName: '' }))
        .rejects.toThrow('archivo');
    });

    it('rejects long fileName', async () => {
      await expect(svc.uploadDocument({ ...validUpload, fileName: 'x'.repeat(256) }))
        .rejects.toThrow('archivo');
    });

    it('rejects unsupported mimeType', async () => {
      await expect(svc.uploadDocument({ ...validUpload, mimeType: 'video/mp4' }))
        .rejects.toThrow('MIME');
    });

    it('rejects zero fileSize', async () => {
      await expect(svc.uploadDocument({ ...validUpload, fileSize: 0 }))
        .rejects.toThrow('Tamaño');
    });

    it('rejects oversized file', async () => {
      await expect(svc.uploadDocument({ ...validUpload, fileSize: 11 * 1024 * 1024 }))
        .rejects.toThrow('Tamaño');
    });

    it('rejects empty storageUrl', async () => {
      await expect(svc.uploadDocument({ ...validUpload, storageUrl: '' }))
        .rejects.toThrow('almacenamiento');
    });

    it('accepts all valid mime types', async () => {
      for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
        const doc = await svc.uploadDocument({ ...validUpload, mimeType: mime });
        expect(doc.mimeType).toBe(mime);
      }
    });

    it('accepts all valid document types', async () => {
      const types = ['cedula_frontal', 'cedula_reverso', 'selfie', 'comprobante_domicilio', 'certificado_actividades'] as const;
      for (const t of types) {
        const doc = await svc.uploadDocument({ ...validUpload, type: t });
        expect(doc.type).toBe(t);
      }
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const doc = await svc.uploadDocument(validUpload);
      expect(doc.id).toBeDefined();
    });
  });

  // ─── getDocument ────────────────────────────────────────

  describe('getDocument', () => {
    it('returns stored document', async () => {
      const doc: KycDocument = {
        id: 'doc_abc', userId: 'u1', type: 'cedula_frontal',
        fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 100,
        storageUrl: 'gs://b/f.jpg', status: 'pending',
        rejectionReason: null, reviewedBy: null,
        uploadedAt: '2026-01-01', reviewedAt: null, expiresAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(doc));
      const result = await svc.getDocument('doc_abc');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('doc_abc');
    });

    it('returns null when not found', async () => {
      expect(await svc.getDocument('doc_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getDocument('doc_abc')).toBeNull();
    });
  });

  // ─── getUserDocuments ───────────────────────────────────

  describe('getUserDocuments', () => {
    it('returns user documents', async () => {
      const doc: KycDocument = {
        id: 'doc_1', userId: 'u1', type: 'selfie',
        fileName: 'selfie.jpg', mimeType: 'image/jpeg', fileSize: 200,
        storageUrl: 'gs://b/s.jpg', status: 'approved',
        rejectionReason: null, reviewedBy: 'admin1',
        uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_1']));
        if (key === 'kyc:doc:doc_1') return Promise.resolve(JSON.stringify(doc));
        return Promise.resolve(null);
      });

      const result = await svc.getUserDocuments('u1');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('selfie');
    });

    it('returns empty when none', async () => {
      expect(await svc.getUserDocuments('u-none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getUserDocuments('u1')).toEqual([]);
    });
  });

  // ─── reviewDocument ─────────────────────────────────────

  describe('reviewDocument', () => {
    const pendingDoc: KycDocument = {
      id: 'doc_r1', userId: 'u1', type: 'cedula_frontal',
      fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 100,
      storageUrl: 'gs://b/f.jpg', status: 'pending',
      rejectionReason: null, reviewedBy: null,
      uploadedAt: '2026-01-01', reviewedAt: null, expiresAt: null,
    };

    it('approves a pending document', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(pendingDoc));
      const result = await svc.reviewDocument('doc_r1', 'approved', 'admin1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.reviewedBy).toBe('admin1');
      expect(result!.reviewedAt).not.toBeNull();
      expect(result!.expiresAt).not.toBeNull();
    });

    it('rejects a pending document with reason', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(pendingDoc));
      const result = await svc.reviewDocument('doc_r1', 'rejected', 'admin1', 'Imagen borrosa');
      expect(result!.status).toBe('rejected');
      expect(result!.rejectionReason).toBe('Imagen borrosa');
    });

    it('uses default rejection reason', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(pendingDoc));
      const result = await svc.reviewDocument('doc_r1', 'rejected', 'admin1');
      expect(result!.rejectionReason).toBe('Documento rechazado');
    });

    it('allows reviewing a document in reviewing status', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...pendingDoc, status: 'reviewing' }));
      const result = await svc.reviewDocument('doc_r1', 'approved', 'admin1');
      expect(result!.status).toBe('approved');
    });

    it('throws when reviewing already approved doc', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...pendingDoc, status: 'approved' }));
      await expect(svc.reviewDocument('doc_r1', 'rejected', 'admin1'))
        .rejects.toThrow('No se puede revisar');
    });

    it('returns null for unknown document', async () => {
      expect(await svc.reviewDocument('doc_unknown', 'approved', 'admin1')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.reviewDocument('doc_r1', 'approved', 'admin1')).toBeNull();
    });
  });

  // ─── startVerification ──────────────────────────────────

  describe('startVerification', () => {
    it('starts INTERMEDIATE verification with all docs', async () => {
      const docs: KycDocument[] = [
        { id: 'doc_cf', userId: 'u1', type: 'cedula_frontal', fileName: 'cf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cf.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
        { id: 'doc_cr', userId: 'u1', type: 'cedula_reverso', fileName: 'cr.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cr.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
        { id: 'doc_sf', userId: 'u1', type: 'selfie', fileName: 'sf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/sf.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_cf', 'doc_cr', 'doc_sf']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const v = await svc.startVerification('u1', 'INTERMEDIATE');
      expect(v.id).toMatch(/^kyv_/);
      expect(v.status).toBe('reviewing');
      expect(v.documents).toHaveLength(3);
      expect(v.notes).toBeNull();
    });

    it('starts with pending status when docs missing', async () => {
      // User has only cedula_frontal
      const docs: KycDocument[] = [
        { id: 'doc_cf', userId: 'u1', type: 'cedula_frontal', fileName: 'cf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cf.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_cf']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const v = await svc.startVerification('u1', 'INTERMEDIATE');
      expect(v.status).toBe('pending');
      expect(v.notes).toContain('faltantes');
      expect(v.notes).toContain('cedula_reverso');
      expect(v.notes).toContain('selfie');
    });

    it('throws for BASIC tier', async () => {
      await expect(svc.startVerification('u1', 'BASIC'))
        .rejects.toThrow('No se requiere');
    });

    it('saves verification to Redis', async () => {
      await svc.startVerification('u1', 'INTERMEDIATE');
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^kyc:verification:kyv_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('includes pending docs when no approved exist', async () => {
      const docs: KycDocument[] = [
        { id: 'doc_cf', userId: 'u1', type: 'cedula_frontal', fileName: 'cf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cf.jpg', status: 'pending', rejectionReason: null, reviewedBy: null, uploadedAt: '2026-01-01', reviewedAt: null, expiresAt: null },
        { id: 'doc_cr', userId: 'u1', type: 'cedula_reverso', fileName: 'cr.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cr.jpg', status: 'pending', rejectionReason: null, reviewedBy: null, uploadedAt: '2026-01-01', reviewedAt: null, expiresAt: null },
        { id: 'doc_sf', userId: 'u1', type: 'selfie', fileName: 'sf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/sf.jpg', status: 'pending', rejectionReason: null, reviewedBy: null, uploadedAt: '2026-01-01', reviewedAt: null, expiresAt: null },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_cf', 'doc_cr', 'doc_sf']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const v = await svc.startVerification('u1', 'INTERMEDIATE');
      // Pending docs are found but not approved → still missing
      expect(v.documents).toHaveLength(3);
    });
  });

  // ─── getVerification ────────────────────────────────────

  describe('getVerification', () => {
    it('returns stored verification', async () => {
      const v: KycVerification = {
        id: 'kyv_1', userId: 'u1', targetTier: 'INTERMEDIATE',
        documents: ['doc_1'], status: 'reviewing', notes: null,
        reviewedBy: null, createdAt: '2026-01-01', completedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(v));
      const result = await svc.getVerification('kyv_1');
      expect(result).not.toBeNull();
      expect(result!.targetTier).toBe('INTERMEDIATE');
    });

    it('returns null when not found', async () => {
      expect(await svc.getVerification('kyv_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getVerification('kyv_1')).toBeNull();
    });
  });

  // ─── completeVerification ───────────────────────────────

  describe('completeVerification', () => {
    const reviewingV: KycVerification = {
      id: 'kyv_rv', userId: 'u1', targetTier: 'INTERMEDIATE',
      documents: ['doc_1', 'doc_2'], status: 'reviewing', notes: null,
      reviewedBy: null, createdAt: '2026-01-01', completedAt: null,
    };

    it('approves a reviewing verification', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(reviewingV));
      const result = await svc.completeVerification('kyv_rv', 'approved', 'admin1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.reviewedBy).toBe('admin1');
      expect(result!.completedAt).not.toBeNull();
    });

    it('rejects a verification with notes', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(reviewingV));
      const result = await svc.completeVerification('kyv_rv', 'rejected', 'admin1', 'Selfie no coincide');
      expect(result!.status).toBe('rejected');
      expect(result!.notes).toBe('Selfie no coincide');
    });

    it('completes a pending verification', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...reviewingV, status: 'pending' }));
      const result = await svc.completeVerification('kyv_rv', 'approved', 'admin1');
      expect(result!.status).toBe('approved');
    });

    it('throws when completing already completed', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...reviewingV, status: 'approved' }));
      await expect(svc.completeVerification('kyv_rv', 'rejected', 'admin1'))
        .rejects.toThrow('No se puede completar');
    });

    it('returns null for unknown verification', async () => {
      expect(await svc.completeVerification('kyv_unknown', 'approved', 'admin1')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.completeVerification('kyv_1', 'approved', 'admin1')).toBeNull();
    });
  });

  // ─── getUserVerifications ───────────────────────────────

  describe('getUserVerifications', () => {
    it('returns user verifications', async () => {
      const v: KycVerification = {
        id: 'kyv_1', userId: 'u1', targetTier: 'INTERMEDIATE',
        documents: [], status: 'approved', notes: null,
        reviewedBy: 'admin1', createdAt: '2026-01-01', completedAt: '2026-01-03',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-verifications:u1') return Promise.resolve(JSON.stringify(['kyv_1']));
        if (key === 'kyc:verification:kyv_1') return Promise.resolve(JSON.stringify(v));
        return Promise.resolve(null);
      });

      const result = await svc.getUserVerifications('u1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      expect(await svc.getUserVerifications('u-none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getUserVerifications('u1')).toEqual([]);
    });
  });

  // ─── getRequirements ────────────────────────────────────

  describe('getRequirements', () => {
    it('returns all tier requirements', () => {
      const reqs = svc.getRequirements();
      expect(reqs).toHaveLength(3);
    });

    it('returns specific tier requirement', () => {
      const reqs = svc.getRequirements('INTERMEDIATE');
      expect(reqs).toHaveLength(1);
      expect(reqs[0].requiredDocuments).toContain('cedula_frontal');
      expect(reqs[0].requiredDocuments).toContain('selfie');
    });

    it('returns empty for unknown tier', () => {
      expect(svc.getRequirements('ULTRA' as any)).toEqual([]);
    });

    it('BASIC requires no documents', () => {
      const reqs = svc.getRequirements('BASIC');
      expect(reqs[0].requiredDocuments).toHaveLength(0);
    });

    it('FULL requires 5 documents', () => {
      const reqs = svc.getRequirements('FULL');
      expect(reqs[0].requiredDocuments).toHaveLength(5);
    });
  });

  // ─── checkTierEligibility ──────────────────────────────

  describe('checkTierEligibility', () => {
    it('returns eligible when all docs approved', async () => {
      const docs: KycDocument[] = [
        { id: 'doc_cf', userId: 'u1', type: 'cedula_frontal', fileName: 'cf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cf.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
        { id: 'doc_cr', userId: 'u1', type: 'cedula_reverso', fileName: 'cr.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cr.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
        { id: 'doc_sf', userId: 'u1', type: 'selfie', fileName: 'sf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/sf.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_cf', 'doc_cr', 'doc_sf']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const result = await svc.checkTierEligibility('u1', 'INTERMEDIATE');
      expect(result.eligible).toBe(true);
      expect(result.missingDocuments).toHaveLength(0);
      expect(result.approvedDocuments).toContain('cedula_frontal');
    });

    it('returns not eligible with missing docs', async () => {
      // Only has cedula_frontal approved
      const docs: KycDocument[] = [
        { id: 'doc_cf', userId: 'u1', type: 'cedula_frontal', fileName: 'cf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cf.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_cf']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const result = await svc.checkTierEligibility('u1', 'INTERMEDIATE');
      expect(result.eligible).toBe(false);
      expect(result.missingDocuments).toContain('cedula_reverso');
      expect(result.missingDocuments).toContain('selfie');
    });

    it('ignores non-approved docs', async () => {
      const docs: KycDocument[] = [
        { id: 'doc_cf', userId: 'u1', type: 'cedula_frontal', fileName: 'cf.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/cf.jpg', status: 'rejected', rejectionReason: 'borrosa', reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: null },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_cf']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const result = await svc.checkTierEligibility('u1', 'INTERMEDIATE');
      expect(result.eligible).toBe(false);
      expect(result.missingDocuments).toContain('cedula_frontal');
    });

    it('returns not eligible for unknown tier', async () => {
      const result = await svc.checkTierEligibility('u1', 'ULTRA' as any);
      expect(result.eligible).toBe(false);
    });
  });

  // ─── getDocumentStats ──────────────────────────────────

  describe('getDocumentStats', () => {
    it('calculates document stats', async () => {
      const docs: KycDocument[] = [
        { id: 'doc_1', userId: 'u1', type: 'cedula_frontal', fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/1.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
        { id: 'doc_2', userId: 'u1', type: 'cedula_reverso', fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/2.jpg', status: 'approved', rejectionReason: null, reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: '2028-01-02' },
        { id: 'doc_3', userId: 'u1', type: 'selfie', fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'gs://b/3.jpg', status: 'pending', rejectionReason: null, reviewedBy: null, uploadedAt: '2026-01-01', reviewedAt: null, expiresAt: null },
        { id: 'doc_4', userId: 'u1', type: 'comprobante_domicilio', fileName: 'f.pdf', mimeType: 'application/pdf', fileSize: 100, storageUrl: 'gs://b/4.pdf', status: 'rejected', rejectionReason: 'ilegible', reviewedBy: 'a', uploadedAt: '2026-01-01', reviewedAt: '2026-01-02', expiresAt: null },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'kyc:user-docs:u1') return Promise.resolve(JSON.stringify(['doc_1', 'doc_2', 'doc_3', 'doc_4']));
        const d = docs.find((x) => `kyc:doc:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const stats = await svc.getDocumentStats('u1');
      expect(stats.total).toBe(4);
      expect(stats.approved).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.rejected).toBe(1);
    });

    it('returns zeros when no docs', async () => {
      const stats = await svc.getDocumentStats('u-none');
      expect(stats.total).toBe(0);
      expect(stats.approved).toBe(0);
    });
  });
});
