/**
 * Route-level tests for notification-templates.routes.ts
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
import type { NotificationTemplate } from '../../src/services/notification-templates.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const sampleTemplate: NotificationTemplate = {
  id: 'ntpl_test001', name: 'Pago exitoso', channel: 'whatsapp', category: 'payment',
  subject: null, body: 'Hola {{nombre}}, tu pago de {{monto}} fue exitoso.',
  variables: ['nombre', 'monto'], locale: 'es-CL', active: true, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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

describe('GET /api/v1/admin/notification-templates', () => {
  it('lists templates', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'ntpl:index') return Promise.resolve(JSON.stringify(['ntpl_test001']));
      if (key === 'ntpl:ntpl_test001') return Promise.resolve(JSON.stringify(sampleTemplate));
      return Promise.resolve(null);
    });
    const res = await client.get('/api/v1/admin/notification-templates', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(1);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/notification-templates');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/admin/notification-templates', () => {
  it('creates a template', async () => {
    const res = await client.post('/api/v1/admin/notification-templates', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { name: 'Bienvenida', channel: 'whatsapp', category: 'onboarding', body: 'Hola {{nombre}}!' },
    });
    expect(res.status).toBe(201);
    const body = res.body as { template: NotificationTemplate };
    expect(body.template.id).toMatch(/^ntpl_/);
    expect(body.template.variables).toContain('nombre');
  });

  it('returns 400 for missing body', async () => {
    const res = await client.post('/api/v1/admin/notification-templates', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { name: 'Test', channel: 'sms', category: 'system' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid channel', async () => {
    const res = await client.post('/api/v1/admin/notification-templates', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { name: 'Test', channel: 'telegram', category: 'system', body: 'Hi' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/notification-templates/:id', () => {
  it('returns template detail', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleTemplate));
    const res = await client.get('/api/v1/admin/notification-templates/ntpl_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { template: NotificationTemplate }).template.name).toBe('Pago exitoso');
  });

  it('returns 404 for unknown template', async () => {
    const res = await client.get('/api/v1/admin/notification-templates/ntpl_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/notification-templates/:id/update', () => {
  it('updates template body', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleTemplate));
    const res = await client.post('/api/v1/admin/notification-templates/ntpl_test001/update', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { body: 'Hola {{nombre}}, pagaste {{monto}} CLP.' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { template: NotificationTemplate }).template.version).toBe(2);
  });
});

describe('DELETE /api/v1/admin/notification-templates/:id', () => {
  it('deactivates a template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleTemplate));
    const res = await client.delete('/api/v1/admin/notification-templates/ntpl_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('desactivado');
  });

  it('returns 404 for unknown template', async () => {
    const res = await client.delete('/api/v1/admin/notification-templates/ntpl_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/notification-templates/:id/render', () => {
  it('renders template with variables', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleTemplate));
    const res = await client.post('/api/v1/admin/notification-templates/ntpl_test001/render', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { variables: { nombre: 'Pablo', monto: '$5.000' } },
    });
    expect(res.status).toBe(200);
    const body = res.body as { rendered: { body: string } };
    expect(body.rendered.body).toContain('Pablo');
    expect(body.rendered.body).toContain('$5.000');
  });

  it('returns 400 for missing variables', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleTemplate));
    const res = await client.post('/api/v1/admin/notification-templates/ntpl_test001/render', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { variables: { nombre: 'Pablo' } }, // missing monto
    });
    expect(res.status).toBe(400);
  });
});
