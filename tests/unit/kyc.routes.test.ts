/**
 * Route-level tests for kyc.routes.ts
 * Covers: POST /kyc/documents, GET /kyc/documents, GET /kyc/requirements,
 *         GET /kyc/eligibility, POST /kyc/verify, GET /kyc/verifications,
 *         POST /admin/kyc/documents/:id/review, POST /admin/kyc/verifications/:id/complete
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
    APP_BASE_URL: 'http://localhost:3000',
    ADMIN_API_KEY: 'test-admin-key-at-least-32-characters-long',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sCard: jest.fn(),
    lPush: jest.fn(),
    lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true),
    del: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  }),
  connectRedis: jest.fn(),
  prisma: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../src/services/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

import { startTestServer, type TestClient } from './http-test-client';
import jwt from 'jsonwebtoken';
import type { KycDocument, KycVerification } from '../../src/services/kyc-document.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign(
    { userId, waId: '56912345678', kycLevel: 'BASIC' },
    JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' },
  );

let client: TestClient;

const sampleDoc: KycDocument = {
  id: 'doc_test001',
  userId: 'user-1',
  type: 'cedula_frontal',
  fileName: 'cedula-front.jpg',
  mimeType: 'image/jpeg',
  fileSize: 500000,
  storageUrl: 'gs://bucket/user-1/cedula-front.jpg',
  status: 'pending',
  rejectionReason: null,
  reviewedBy: null,
  uploadedAt: new Date().toISOString(),
  reviewedAt: null,
  expiresAt: null,
};

const approvedDoc: KycDocument = {
  ...sampleDoc,
  id: 'doc_test002',
  status: 'approved',
  reviewedBy: 'admin',
  reviewedAt: new Date().toISOString(),
};

const sampleVerification: KycVerification = {
  id: 'kyv_test001',
  userId: 'user-1',
  targetTier: 'INTERMEDIATE',
  documents: ['doc_test001'],
  status: 'reviewing',
  notes: null,
  reviewedBy: null,
  createdAt: new Date().toISOString(),
  completedAt: null,
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisIncr.mockResolvedValue(1);
});

// ─── POST /api/v1/kyc/documents ─────────────────────────

describe('POST /api/v1/kyc/documents', () => {
  it('uploads a document', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/kyc/documents', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'cedula_frontal',
        fileName: 'cedula.jpg',
        mimeType: 'image/jpeg',
        fileSize: 250000,
        storageUrl: 'gs://bucket/user-1/cedula.jpg',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { document: KycDocument };
    expect(body.document.id).toMatch(/^doc_/);
    expect(body.document.type).toBe('cedula_frontal');
    expect(body.document.status).toBe('pending');
  });

  it('returns 400 for invalid document type', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/kyc/documents', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'passport',
        fileName: 'pass.jpg',
        mimeType: 'image/jpeg',
        fileSize: 100000,
        storageUrl: 'gs://bucket/pass.jpg',
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid MIME type', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/kyc/documents', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'selfie',
        fileName: 'selfie.bmp',
        mimeType: 'image/bmp',
        fileSize: 100000,
        storageUrl: 'gs://bucket/selfie.bmp',
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for file too large', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/kyc/documents', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        type: 'cedula_frontal',
        fileName: 'big.jpg',
        mimeType: 'image/jpeg',
        fileSize: 20 * 1024 * 1024, // 20MB
        storageUrl: 'gs://bucket/big.jpg',
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/kyc/documents', {
      body: { type: 'selfie', fileName: 'x.jpg', mimeType: 'image/jpeg', fileSize: 100, storageUrl: 'x' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/kyc/documents ──────────────────────────

describe('GET /api/v1/kyc/documents', () => {
  it('returns user documents with stats', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'kyc:user-docs:user-1') return Promise.resolve(JSON.stringify(['doc_test001']));
      if (key === 'kyc:doc:doc_test001') return Promise.resolve(JSON.stringify(sampleDoc));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/kyc/documents', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { documents: KycDocument[]; stats: { total: number } };
    expect(body.documents).toHaveLength(1);
    expect(body.stats.total).toBe(1);
  });

  it('returns empty for new user', async () => {
    const token = makeToken('new-user');
    const res = await client.get('/api/v1/kyc/documents', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { documents: unknown[] }).documents).toEqual([]);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/kyc/documents');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/kyc/requirements ───────────────────────

describe('GET /api/v1/kyc/requirements', () => {
  it('returns all tier requirements (public)', async () => {
    const res = await client.get('/api/v1/kyc/requirements');
    expect(res.status).toBe(200);
    const body = res.body as { requirements: Array<{ tier: string }> };
    expect(body.requirements.length).toBeGreaterThanOrEqual(3);
    expect(body.requirements.map((r) => r.tier)).toContain('INTERMEDIATE');
  });

  it('does not require authentication', async () => {
    const res = await client.get('/api/v1/kyc/requirements');
    expect(res.status).not.toBe(401);
  });
});

// ─── GET /api/v1/kyc/eligibility ────────────────────────

describe('GET /api/v1/kyc/eligibility', () => {
  it('returns eligibility check', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/kyc/eligibility?tier=INTERMEDIATE', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { eligible: boolean; missingDocuments: string[] };
    expect(typeof body.eligible).toBe('boolean');
    expect(Array.isArray(body.missingDocuments)).toBe(true);
  });

  it('returns 400 for invalid tier', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/kyc/eligibility?tier=INVALID', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/kyc/eligibility');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/kyc/verify ────────────────────────────

describe('POST /api/v1/kyc/verify', () => {
  it('starts verification process', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/kyc/verify', {
      headers: { Authorization: `Bearer ${token}` },
      body: { targetTier: 'INTERMEDIATE' },
    });
    expect(res.status).toBe(201);
    const body = res.body as { verification: KycVerification };
    expect(body.verification.id).toMatch(/^kyv_/);
    expect(body.verification.targetTier).toBe('INTERMEDIATE');
  });

  it('returns 400 for invalid tier', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/kyc/verify', {
      headers: { Authorization: `Bearer ${token}` },
      body: { targetTier: 'SUPER' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/kyc/verify', {
      body: { targetTier: 'INTERMEDIATE' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/kyc/verifications ──────────────────────

describe('GET /api/v1/kyc/verifications', () => {
  it('returns user verifications', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'kyc:user-verifications:user-1') return Promise.resolve(JSON.stringify(['kyv_test001']));
      if (key === 'kyc:verification:kyv_test001') return Promise.resolve(JSON.stringify(sampleVerification));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/kyc/verifications', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { verifications: KycVerification[]; count: number };
    expect(body.count).toBe(1);
    expect(body.verifications[0].targetTier).toBe('INTERMEDIATE');
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/kyc/verifications');
    expect(res.status).toBe(401);
  });
});

// ─── POST /admin/kyc/documents/:id/review ───────────────

describe('POST /api/v1/admin/kyc/documents/:id/review', () => {
  it('approves a document with admin key', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'kyc:doc:doc_test001') return Promise.resolve(JSON.stringify(sampleDoc));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/kyc/documents/doc_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { document: KycDocument }).document.status).toBe('approved');
  });

  it('rejects a document with reason', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'kyc:doc:doc_test001') return Promise.resolve(JSON.stringify(sampleDoc));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/kyc/documents/doc_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { decision: 'rejected', rejectionReason: 'Imagen borrosa' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { document: KycDocument };
    expect(body.document.status).toBe('rejected');
    expect(body.document.rejectionReason).toBe('Imagen borrosa');
  });

  it('returns 404 for unknown document', async () => {
    const res = await client.post('/api/v1/admin/kyc/documents/doc_unknown/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/kyc/documents/doc_test001/review', {
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── POST /admin/kyc/verifications/:id/complete ─────────

describe('POST /api/v1/admin/kyc/verifications/:id/complete', () => {
  it('completes verification with admin key', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'kyc:verification:kyv_test001') return Promise.resolve(JSON.stringify(sampleVerification));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/kyc/verifications/kyv_test001/complete', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { decision: 'approved', notes: 'Documentos verificados' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { verification: KycVerification }).verification.status).toBe('approved');
  });

  it('returns 404 for unknown verification', async () => {
    const res = await client.post('/api/v1/admin/kyc/verifications/kyv_unknown/complete', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/kyc/verifications/kyv_test001/complete', {
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(401);
  });
});
