/**
 * Route-level tests for contacts.routes.ts
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test', JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m', APP_BASE_URL: 'http://localhost:3000',
    ADMIN_API_KEY: 'test-admin-key-at-least-32-characters-long',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    del: jest.fn(), sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
  }),
  connectRedis: jest.fn(),
  prisma: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() })),
}));

import { startTestServer, type TestClient } from './http-test-client';
import jwt from 'jsonwebtoken';
import type { Contact } from '../../src/services/contacts.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign({ userId, waId: '56912345678', kycLevel: 'BASIC' }, JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' });

let client: TestClient;

const sampleContact: Contact = {
  userId: 'contact-1', waId: '56987654321', name: 'María López',
  alias: 'Mamá', addedAt: new Date().toISOString(),
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { await client.close(); });
beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
});

describe('GET /api/v1/contacts', () => {
  it('returns empty for new user', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/contacts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { contacts: Contact[]; count: number }).count).toBe(0);
  });

  it('returns saved contacts', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleContact]));
    const res = await client.get('/api/v1/contacts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(1);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/contacts');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/contacts', () => {
  it('adds a new contact', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/contacts', {
      headers: { Authorization: `Bearer ${token}` },
      body: { userId: 'contact-2', waId: '56911111111', name: 'Juan Pérez' },
    });
    expect(res.status).toBe(201);
  });

  it('returns 409 for duplicate contact', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleContact]));
    const res = await client.post('/api/v1/contacts', {
      headers: { Authorization: `Bearer ${token}` },
      body: { userId: 'contact-1', waId: '56987654321', name: 'María' },
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid phone', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/contacts', {
      headers: { Authorization: `Bearer ${token}` },
      body: { userId: 'x', waId: '123', name: 'Test' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/contacts', {
      body: { userId: 'x', waId: '56911111111', name: 'Test' },
    });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/v1/contacts/:contactUserId', () => {
  it('removes a contact', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleContact]));
    const res = await client.delete('/api/v1/contacts/contact-1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown contact', async () => {
    const token = makeToken('user-1');
    const res = await client.delete('/api/v1/contacts/unknown', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/contacts/search', () => {
  it('finds by phone', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleContact]));
    const res = await client.get('/api/v1/contacts/search?phone=56987654321', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { contact: Contact }).contact.name).toBe('María López');
  });

  it('returns null for no match', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/contacts/search?phone=56999999999', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { contact: null }).contact).toBeNull();
  });

  it('returns 400 without phone param', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/contacts/search', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});
