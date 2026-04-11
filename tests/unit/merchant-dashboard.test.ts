/**
 * MerchantDashboardService — métricas en tiempo real.
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

import { MerchantDashboardService } from '../../src/services/merchant-dashboard.service';

describe('MerchantDashboardService', () => {
  let service: MerchantDashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantDashboardService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('returns empty metrics for new merchant', async () => {
    const m = await service.getMetrics('m1');
    expect(m.merchantId).toBe('m1');
    expect(m.today.revenue).toBe(0);
    expect(m.today.transactions).toBe(0);
    expect(m.alerts).toEqual([]);
  });

  it('returns cached metrics', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', today: { revenue: 50000, transactions: 10 }, alerts: [],
    }));
    const m = await service.getMetrics('m1');
    expect(m.today.revenue).toBe(50000);
  });

  it('updates metrics', async () => {
    const m = await service.updateMetrics('m1', {
      today: { revenue: 100000, transactions: 25, customers: 15, avgTicket: 4000 },
      week: { revenue: 500000, transactions: 120, customers: 60, avgTicket: 4167 },
      month: { revenue: 2000000, transactions: 500, customers: 200, avgTicket: 4000 },
      topProducts: [{ name: 'Café', count: 50, revenue: 150000 }],
      recentTransactions: [],
      alerts: [],
    });
    expect(m.today.revenue).toBe(100000);
    expect(m.topProducts).toHaveLength(1);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('adds alert', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', today: {}, week: {}, month: {},
      topProducts: [], recentTransactions: [], alerts: [],
    }));
    await service.addAlert('m1', 'LOW_STOCK', 'Café tiene stock bajo');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.alerts).toHaveLength(1);
    expect(saved.alerts[0].message).toBe('Café tiene stock bajo');
  });

  it('limits alerts to 10', async () => {
    const alerts = Array.from({ length: 10 }, (_, i) => ({ type: 'INFO', message: `Alert ${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', today: {}, week: {}, month: {},
      topProducts: [], recentTransactions: [], alerts,
    }));
    await service.addAlert('m1', 'NEW', 'New alert');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.alerts).toHaveLength(10);
    expect(saved.alerts[9].message).toBe('New alert');
  });

  it('clears alerts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', today: {}, week: {}, month: {},
      topProducts: [], recentTransactions: [], alerts: [{ type: 'x', message: 'y' }],
    }));
    await service.clearAlerts('m1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.alerts).toEqual([]);
  });

  it('formats summary', () => {
    const summary = service.formatSummary({
      merchantId: 'm1',
      today: { revenue: 100000, transactions: 25, customers: 15, avgTicket: 4000 },
      week: { revenue: 500000, transactions: 120, customers: 60, avgTicket: 4167 },
      month: { revenue: 2000000, transactions: 500, customers: 200, avgTicket: 4000 },
      topProducts: [], recentTransactions: [], alerts: [{ type: 'x', message: 'y' }],
      updatedAt: '',
    });
    expect(summary).toContain('$100.000');
    expect(summary).toContain('25 tx');
    expect(summary).toContain('1 alerta');
  });

  it('calculates growth up', () => {
    const g = service.calculateGrowth(150, 100);
    expect(g.pct).toBe(50);
    expect(g.direction).toBe('up');
  });

  it('calculates growth down', () => {
    const g = service.calculateGrowth(80, 100);
    expect(g.pct).toBe(20);
    expect(g.direction).toBe('down');
  });

  it('handles zero previous', () => {
    const g = service.calculateGrowth(100, 0);
    expect(g.direction).toBe('flat');
  });
});
