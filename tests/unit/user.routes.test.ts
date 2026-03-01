/**
 * Route-level tests for user.routes.ts (POST /login, POST /register, GET /me).
 * Uses http-test-client (Node built-ins) — no external packages required.
 */

// ─── Mock variables (must be prefixed with 'mock' for jest hoisting) ─────────

const mockGetUserByWaId = jest.fn();
const mockVerifyUserPin = jest.fn();
const mockCreateUser = jest.fn();
const mockGetUserById = jest.fn();
const mockGetBalance = jest.fn();
const mockGetTransactionStats = jest.fn();

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
    APP_BASE_URL: 'http://localhost:3000',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({ ping: jest.fn(), multi: jest.fn() }),
  prisma: {},
}));

jest.mock('../../src/services/user.service', () => ({
  UserService: jest.fn().mockImplementation(() => ({
    getUserByWaId: mockGetUserByWaId,
    verifyUserPin: mockVerifyUserPin,
    createUser: mockCreateUser,
    getUserById: mockGetUserById,
  })),
}));

jest.mock('../../src/services/wallet.service', () => ({
  WalletService: jest.fn().mockImplementation(() => ({
    getBalance: mockGetBalance,
  })),
}));

jest.mock('../../src/services/transaction.service', () => ({
  TransactionService: jest.fn().mockImplementation(() => ({
    getTransactionStats: mockGetTransactionStats,
  })),
}));

// Bypass Redis-backed rate limiting in all route tests
jest.mock('../../src/middleware/auth.middleware', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  isSecurePin: jest.fn().mockReturnValue(true),
}));

import express from 'express';
import router from '../../src/api/user.routes';
import { generateToken } from '../../src/middleware/jwt.middleware';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const validUser = {
  id: 'user-uuid-001',
  waId: '56912345678',
  name: 'Juan Pérez',
  kycLevel: 'BASIC',
  biometricEnabled: false,
  createdAt: new Date(),
};

const validToken = () =>
  generateToken({ userId: validUser.id, waId: validUser.waId, kycLevel: 'BASIC' });

// ─── Server Lifecycle ─────────────────────────────────────────────────────────

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── POST /login ──────────────────────────────────────────────────────────────

describe('POST /login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when body is missing required fields', async () => {
    const res = await client.post('/login', { body: {} });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Datos inválidos.');
  });

  it('returns 400 when waId is too short', async () => {
    const res = await client.post('/login', { body: { waId: '123', pin: '847293' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pin is not 6 digits', async () => {
    const res = await client.post('/login', { body: { waId: '56912345678', pin: '12345' } });
    expect(res.status).toBe(400);
  });

  it('returns 401 when user does not exist', async () => {
    mockGetUserByWaId.mockResolvedValue(null);
    const res = await client.post('/login', { body: { waId: '56912345678', pin: '847293' } });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('Usuario no encontrado.');
  });

  it('returns 401 when PIN is incorrect', async () => {
    mockGetUserByWaId.mockResolvedValue(validUser);
    mockVerifyUserPin.mockResolvedValue({ success: false, message: 'PIN incorrecto.' });
    const res = await client.post('/login', { body: { waId: '56912345678', pin: '000000' } });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe('PIN incorrecto.');
  });

  it('returns 423 when account is locked', async () => {
    mockGetUserByWaId.mockResolvedValue(validUser);
    mockVerifyUserPin.mockResolvedValue({
      success: false,
      isLocked: true,
      message: 'Cuenta bloqueada.',
    });
    const res = await client.post('/login', { body: { waId: '56912345678', pin: '000000' } });
    expect(res.status).toBe(423);
    expect((res.body as { locked: boolean }).locked).toBe(true);
  });

  it('returns 200 with JWT and user info on success', async () => {
    mockGetUserByWaId.mockResolvedValue(validUser);
    mockVerifyUserPin.mockResolvedValue({ success: true, message: 'PIN válido' });
    const res = await client.post('/login', { body: { waId: '56912345678', pin: '847293' } });
    expect(res.status).toBe(200);
    const body = res.body as { token: string; user: { id: string; kycLevel: string } };
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.user.id).toBe(validUser.id);
    expect(body.user.kycLevel).toBe('BASIC');
  });
});

// ─── POST /register ───────────────────────────────────────────────────────────

describe('POST /register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when body is missing required fields', async () => {
    const res = await client.post('/register', { body: {} });
    expect(res.status).toBe(400);
  });

  it('returns 400 when waId is too short', async () => {
    const res = await client.post('/register', {
      body: { waId: '123', rut: '12345678-5', pin: '847293' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when createUser returns an error', async () => {
    mockCreateUser.mockResolvedValue({ success: false, error: 'RUT ya registrado.' });
    const res = await client.post('/register', {
      body: { waId: '56912345678', rut: '12345678-5', pin: '847293' },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('RUT ya registrado.');
  });

  it('returns 201 with token on successful registration', async () => {
    mockCreateUser.mockResolvedValue({ success: true, userId: validUser.id });
    mockGetUserByWaId.mockResolvedValue(validUser);
    const res = await client.post('/register', {
      body: { waId: '56912345678', rut: '12345678-5', pin: '847293', name: 'Juan' },
    });
    expect(res.status).toBe(201);
    const body = res.body as { token: string; user: { kycLevel: string } };
    expect(typeof body.token).toBe('string');
    expect(body.user.kycLevel).toBe('BASIC');
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────────────

describe('GET /me', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when no Authorization header', async () => {
    const res = await client.get('/me');
    expect(res.status).toBe(401);
  });

  it('returns 404 when user not found in DB', async () => {
    mockGetUserById.mockResolvedValue(null);
    const res = await client.get('/me', {
      headers: { Authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('Usuario no encontrado.');
  });

  it('returns 200 with user profile, balance, and stats', async () => {
    mockGetUserById.mockResolvedValue(validUser);
    mockGetBalance.mockResolvedValue({ balance: 50000, currency: 'CLP' });
    mockGetTransactionStats.mockResolvedValue({ total: 5, sent: 3, received: 2 });
    const res = await client.get('/me', {
      headers: { Authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBe(validUser.id);
    expect((body.balance as { balance: number }).balance).toBe(50000);
    expect((body.stats as { total: number }).total).toBe(5);
  });
});
