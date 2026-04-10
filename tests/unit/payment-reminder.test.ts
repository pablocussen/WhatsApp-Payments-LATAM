/**
 * PaymentReminderService — scheduled payment reminders.
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

import { PaymentReminderService } from '../../src/services/payment-reminder.service';

describe('PaymentReminderService', () => {
  let service: PaymentReminderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentReminderService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates a reminder', async () => {
    const rem = await service.createReminder({
      userId: 'u1', recipientPhone: '+56987654321', amount: 15000, description: 'Arriendo mensual',
    });
    expect(rem.id).toMatch(/^rem_/);
    expect(rem.amount).toBe(15000);
    expect(rem.frequency).toBe('ONCE');
    expect(rem.status).toBe('ACTIVE');
    expect(rem.remindersSent).toBe(0);
  });

  it('creates weekly reminder', async () => {
    const rem = await service.createReminder({
      userId: 'u1', recipientPhone: '+56987654321', amount: 5000,
      description: 'Cuota semanal', frequency: 'WEEKLY', maxReminders: 4,
    });
    expect(rem.frequency).toBe('WEEKLY');
    expect(rem.maxReminders).toBe(4);
  });

  it('rejects amount below 100', async () => {
    await expect(service.createReminder({
      userId: 'u1', recipientPhone: '+569', amount: 50, description: 'Test reminder',
    })).rejects.toThrow('100');
  });

  it('rejects missing phone', async () => {
    await expect(service.createReminder({
      userId: 'u1', recipientPhone: '', amount: 1000, description: 'Test reminder',
    })).rejects.toThrow('Telefono');
  });

  it('rejects over 20 reminders', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: `rem_${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.createReminder({
      userId: 'u1', recipientPhone: '+569', amount: 1000, description: 'Test too many reminders',
    })).rejects.toThrow('20');
  });

  it('returns empty reminders for new user', async () => {
    expect(await service.getReminders('u1')).toEqual([]);
  });

  it('returns due reminders', async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    const future = new Date(Date.now() + 100000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rem_1', status: 'ACTIVE', nextReminder: past, remindersSent: 0, maxReminders: 3 },
      { id: 'rem_2', status: 'ACTIVE', nextReminder: future, remindersSent: 0, maxReminders: 3 },
      { id: 'rem_3', status: 'COMPLETED', nextReminder: past, remindersSent: 3, maxReminders: 3 },
    ]));
    const due = await service.getDueReminders('u1');
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('rem_1');
  });

  it('marks reminder as sent and completes ONCE', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rem_1', frequency: 'ONCE', remindersSent: 0, maxReminders: 1, status: 'ACTIVE' },
    ]));
    expect(await service.markSent('u1', 'rem_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('COMPLETED');
    expect(saved[0].remindersSent).toBe(1);
  });

  it('advances next date for recurring', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rem_1', frequency: 'WEEKLY', remindersSent: 1, maxReminders: 4, status: 'ACTIVE', nextReminder: new Date().toISOString() },
    ]));
    await service.markSent('u1', 'rem_1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('ACTIVE');
    expect(saved[0].remindersSent).toBe(2);
  });

  it('cancels a reminder', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rem_1', status: 'ACTIVE' },
    ]));
    expect(await service.cancelReminder('u1', 'rem_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('CANCELLED');
  });

  it('cannot cancel completed reminder', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rem_1', status: 'COMPLETED' },
    ]));
    expect(await service.cancelReminder('u1', 'rem_1')).toBe(false);
  });

  it('formats summary', () => {
    const summary = service.getReminderSummary({
      id: 'rem_1', userId: 'u1', recipientPhone: '+569', amount: 15000,
      description: 'Arriendo', frequency: 'MONTHLY', nextReminder: '', remindersSent: 2, maxReminders: 12,
      status: 'ACTIVE', createdAt: '',
    });
    expect(summary).toContain('$15.000');
    expect(summary).toContain('Arriendo');
    expect(summary).toContain('MONTHLY');
    expect(summary).toContain('2/12');
  });
});
