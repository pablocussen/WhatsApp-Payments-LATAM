/**
 * Unit tests for NotificationTemplatesService.
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

import { NotificationTemplatesService } from '../../src/services/notification-templates.service';
import type { NotificationTemplate } from '../../src/services/notification-templates.service';

describe('NotificationTemplatesService', () => {
  let svc: NotificationTemplatesService;

  beforeEach(() => {
    svc = new NotificationTemplatesService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── createTemplate ───────────────────────────────────

  describe('createTemplate', () => {
    it('creates template with ntpl_ prefix', async () => {
      const t = await svc.createTemplate({
        name: 'Pago exitoso',
        channel: 'whatsapp',
        category: 'payment',
        body: 'Hola {{nombre}}, tu pago de {{monto}} fue exitoso.',
      });
      expect(t.id).toMatch(/^ntpl_[0-9a-f]{16}$/);
      expect(t.channel).toBe('whatsapp');
      expect(t.category).toBe('payment');
      expect(t.active).toBe(true);
      expect(t.version).toBe(1);
      expect(t.locale).toBe('es-CL');
    });

    it('extracts variables from body', async () => {
      const t = await svc.createTemplate({
        name: 'Test',
        channel: 'sms',
        category: 'security',
        body: 'Código: {{codigo}}. Válido por {{minutos}} min.',
      });
      expect(t.variables).toEqual(['codigo', 'minutos']);
    });

    it('deduplicates variables', async () => {
      const t = await svc.createTemplate({
        name: 'Test',
        channel: 'push',
        category: 'system',
        body: '{{nombre}} envió a {{nombre}}',
      });
      expect(t.variables).toEqual(['nombre']);
    });

    it('saves to Redis with TTL', async () => {
      await svc.createTemplate({
        name: 'Test',
        channel: 'whatsapp',
        category: 'payment',
        body: 'Hola {{nombre}}',
      });
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^ntpl:ntpl_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('adds to index', async () => {
      await svc.createTemplate({
        name: 'Test',
        channel: 'whatsapp',
        category: 'payment',
        body: 'Hello',
      });
      const indexCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => c[0] === 'ntpl:index',
      );
      expect(indexCalls).toHaveLength(1);
    });

    it('rejects empty name', async () => {
      await expect(svc.createTemplate({
        name: '',
        channel: 'whatsapp',
        category: 'payment',
        body: 'test',
      })).rejects.toThrow('Nombre');
    });

    it('rejects name over 100 chars', async () => {
      await expect(svc.createTemplate({
        name: 'x'.repeat(101),
        channel: 'whatsapp',
        category: 'payment',
        body: 'test',
      })).rejects.toThrow('Nombre');
    });

    it('rejects invalid channel', async () => {
      await expect(svc.createTemplate({
        name: 'Test',
        channel: 'telegram' as never,
        category: 'payment',
        body: 'test',
      })).rejects.toThrow('Canal inválido');
    });

    it('rejects invalid category', async () => {
      await expect(svc.createTemplate({
        name: 'Test',
        channel: 'whatsapp',
        category: 'billing' as never,
        body: 'test',
      })).rejects.toThrow('Categoría inválida');
    });

    it('rejects empty body', async () => {
      await expect(svc.createTemplate({
        name: 'Test',
        channel: 'whatsapp',
        category: 'payment',
        body: '',
      })).rejects.toThrow('Cuerpo');
    });

    it('rejects body over 4096 chars', async () => {
      await expect(svc.createTemplate({
        name: 'Test',
        channel: 'whatsapp',
        category: 'payment',
        body: 'x'.repeat(4097),
      })).rejects.toThrow('Cuerpo');
    });

    it('requires subject for email channel', async () => {
      await expect(svc.createTemplate({
        name: 'Test',
        channel: 'email',
        category: 'payment',
        body: 'test body',
      })).rejects.toThrow('subject');
    });

    it('allows email with subject', async () => {
      const t = await svc.createTemplate({
        name: 'Email test',
        channel: 'email',
        category: 'payment',
        subject: 'Pago #{{ref}}',
        body: 'Hola {{nombre}}, tu pago fue procesado.',
      });
      expect(t.subject).toBe('Pago #{{ref}}');
      expect(t.variables).toEqual(['ref', 'nombre']);
    });

    it('uses custom locale', async () => {
      const t = await svc.createTemplate({
        name: 'Test',
        channel: 'whatsapp',
        category: 'payment',
        body: 'Hello',
        locale: 'en',
      });
      expect(t.locale).toBe('en');
    });
  });

  // ─── updateTemplate ──────────────────────────────────

  describe('updateTemplate', () => {
    const stored: NotificationTemplate = {
      id: 'ntpl_abc', name: 'Original', channel: 'whatsapp', category: 'payment',
      subject: null, body: 'Hola {{nombre}}', variables: ['nombre'],
      locale: 'es-CL', active: true, version: 1,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('updates body and bumps version', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateTemplate('ntpl_abc', { body: 'Hola {{nombre}}, bienvenido' });
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      expect(result!.body).toBe('Hola {{nombre}}, bienvenido');
    });

    it('updates name', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateTemplate('ntpl_abc', { name: 'Updated' });
      expect(result!.name).toBe('Updated');
    });

    it('returns null for unknown template', async () => {
      const result = await svc.updateTemplate('ntpl_unknown', { body: 'test' });
      expect(result).toBeNull();
    });

    it('rejects empty name', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      await expect(svc.updateTemplate('ntpl_abc', { name: '' }))
        .rejects.toThrow('Nombre');
    });

    it('rejects empty body', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      await expect(svc.updateTemplate('ntpl_abc', { body: '' }))
        .rejects.toThrow('Cuerpo');
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.updateTemplate('ntpl_abc', { body: 'test' });
      expect(result).toBeNull();
    });
  });

  // ─── getTemplate ──────────────────────────────────────

  describe('getTemplate', () => {
    it('returns stored template', async () => {
      const t: NotificationTemplate = {
        id: 'ntpl_1', name: 'Test', channel: 'whatsapp', category: 'payment',
        subject: null, body: 'Hello', variables: [], locale: 'es-CL',
        active: true, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(t));
      const result = await svc.getTemplate('ntpl_1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test');
    });

    it('returns null when not found', async () => {
      const result = await svc.getTemplate('ntpl_unknown');
      expect(result).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getTemplate('ntpl_1');
      expect(result).toBeNull();
    });
  });

  // ─── listTemplates ────────────────────────────────────

  describe('listTemplates', () => {
    const templates: NotificationTemplate[] = [
      { id: 'ntpl_1', name: 'WA Payment', channel: 'whatsapp', category: 'payment', subject: null, body: 'a', variables: [], locale: 'es-CL', active: true, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'ntpl_2', name: 'Email Refund', channel: 'email', category: 'refund', subject: 'Refund', body: 'b', variables: [], locale: 'es-CL', active: true, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'ntpl_3', name: 'Inactive', channel: 'whatsapp', category: 'payment', subject: null, body: 'c', variables: [], locale: 'es-CL', active: false, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ];

    beforeEach(() => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'ntpl:index') return Promise.resolve(JSON.stringify(['ntpl_1', 'ntpl_2', 'ntpl_3']));
        const t = templates.find((x) => `ntpl:${x.id}` === key);
        return Promise.resolve(t ? JSON.stringify(t) : null);
      });
    });

    it('returns all templates', async () => {
      const result = await svc.listTemplates();
      expect(result).toHaveLength(3);
    });

    it('filters by channel', async () => {
      const result = await svc.listTemplates({ channel: 'whatsapp' });
      expect(result).toHaveLength(2);
    });

    it('filters by category', async () => {
      const result = await svc.listTemplates({ category: 'refund' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Email Refund');
    });

    it('filters by active', async () => {
      const result = await svc.listTemplates({ active: true });
      expect(result).toHaveLength(2);
    });

    it('returns empty when no index', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await svc.listTemplates();
      expect(result).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.listTemplates();
      expect(result).toEqual([]);
    });
  });

  // ─── render ───────────────────────────────────────────

  describe('render', () => {
    const template: NotificationTemplate = {
      id: 'ntpl_r1', name: 'Pago', channel: 'whatsapp', category: 'payment',
      subject: null, body: 'Hola {{nombre}}, pagaste {{monto}} a {{destino}}.',
      variables: ['nombre', 'monto', 'destino'],
      locale: 'es-CL', active: true, version: 3,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('renders body with variables', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(template));
      const result = await svc.render('ntpl_r1', {
        nombre: 'Juan',
        monto: '$10.000',
        destino: 'María',
      });
      expect(result).not.toBeNull();
      expect(result!.body).toBe('Hola Juan, pagaste $10.000 a María.');
      expect(result!.templateVersion).toBe(3);
    });

    it('renders subject for email templates', async () => {
      const emailTemplate = {
        ...template, channel: 'email' as const,
        subject: 'Pago de {{monto}}',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(emailTemplate));
      const result = await svc.render('ntpl_r1', {
        nombre: 'Juan',
        monto: '$10.000',
        destino: 'María',
      });
      expect(result!.subject).toBe('Pago de $10.000');
    });

    it('returns null for inactive template', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...template, active: false }));
      const result = await svc.render('ntpl_r1', { nombre: 'A', monto: 'B', destino: 'C' });
      expect(result).toBeNull();
    });

    it('returns null for unknown template', async () => {
      const result = await svc.render('ntpl_unknown', {});
      expect(result).toBeNull();
    });

    it('throws on missing variables', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(template));
      await expect(svc.render('ntpl_r1', { nombre: 'Juan' }))
        .rejects.toThrow('Variables faltantes: monto, destino');
    });
  });

  // ─── deactivateTemplate ──────────────────────────────

  describe('deactivateTemplate', () => {
    it('deactivates a template', async () => {
      const t: NotificationTemplate = {
        id: 'ntpl_d1', name: 'Test', channel: 'whatsapp', category: 'payment',
        subject: null, body: 'x', variables: [], locale: 'es-CL',
        active: true, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(t));

      const result = await svc.deactivateTemplate('ntpl_d1');
      expect(result).toBe(true);
    });

    it('returns false for unknown template', async () => {
      const result = await svc.deactivateTemplate('ntpl_unknown');
      expect(result).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.deactivateTemplate('ntpl_d1');
      expect(result).toBe(false);
    });
  });

  // ─── findByName ──────────────────────────────────────

  describe('findByName', () => {
    it('finds template by name and channel', async () => {
      const t: NotificationTemplate = {
        id: 'ntpl_f1', name: 'Pago Exitoso', channel: 'whatsapp', category: 'payment',
        subject: null, body: 'x', variables: [], locale: 'es-CL',
        active: true, version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'ntpl:index') return Promise.resolve(JSON.stringify(['ntpl_f1']));
        if (key === 'ntpl:ntpl_f1') return Promise.resolve(JSON.stringify(t));
        return Promise.resolve(null);
      });

      const result = await svc.findByName('Pago Exitoso', 'whatsapp');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ntpl_f1');
    });

    it('returns null when not found', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.findByName('Nonexistent', 'whatsapp');
      expect(result).toBeNull();
    });
  });

  // ─── extractVariables ────────────────────────────────

  describe('extractVariables', () => {
    it('extracts {{var}} patterns', () => {
      const vars = svc.extractVariables('Hello {{name}}, your code is {{code}}');
      expect(vars).toEqual(['name', 'code']);
    });

    it('returns empty for no variables', () => {
      expect(svc.extractVariables('Hello world')).toEqual([]);
    });

    it('deduplicates variables', () => {
      const vars = svc.extractVariables('{{a}} and {{a}} again');
      expect(vars).toEqual(['a']);
    });
  });
});
