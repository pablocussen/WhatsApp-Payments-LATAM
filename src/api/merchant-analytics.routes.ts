import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { merchantAnalytics } from '../services/merchant-analytics.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── GET /admin/merchant-analytics/:merchantId/:period/:periodKey ───
// Get metrics for a merchant period

router.get(
  '/admin/merchant-analytics/:merchantId/:period/:periodKey',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { merchantId, period, periodKey } = req.params;
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ error: 'Invalid period. Must be daily, weekly, or monthly.' });
    }
    const metrics = await merchantAnalytics.getMetrics(
      merchantId,
      period as 'daily' | 'weekly' | 'monthly',
      periodKey,
    );
    if (!metrics) {
      return res.status(404).json({ error: 'Metrics not found.' });
    }
    return res.json({ metrics });
  }),
);

// ─── GET /admin/merchant-analytics/:merchantId/trend ────────────────
// Get trend data for a metric

router.get(
  '/admin/merchant-analytics/:merchantId/trend',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { merchantId } = req.params;
    const { period, metric, limit } = req.query;

    if (!period || !['daily', 'weekly', 'monthly'].includes(period as string)) {
      return res.status(400).json({ error: 'Invalid or missing period.' });
    }

    const validMetrics = [
      'totalVolume', 'totalTransactions', 'totalFees',
      'avgTransactionSize', 'successRate', 'uniqueCustomers',
    ];
    if (!metric || !validMetrics.includes(metric as string)) {
      return res.status(400).json({ error: 'Invalid or missing metric.' });
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : undefined;
    const trend = await merchantAnalytics.getTrend(
      merchantId,
      period as 'daily' | 'weekly' | 'monthly',
      metric as any,
      parsedLimit,
    );
    return res.json({ trend });
  }),
);

// ─── GET /admin/merchant-analytics/:merchantId/performance ──────────
// Get performance comparison between two periods

router.get(
  '/admin/merchant-analytics/:merchantId/performance',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { merchantId } = req.params;
    const { period, currentPeriodKey, previousPeriodKey } = req.query;

    if (!period || !['daily', 'weekly', 'monthly'].includes(period as string)) {
      return res.status(400).json({ error: 'Invalid or missing period.' });
    }
    if (!currentPeriodKey || !previousPeriodKey) {
      return res.status(400).json({ error: 'Both currentPeriodKey and previousPeriodKey are required.' });
    }

    const performance = await merchantAnalytics.getPerformance(
      merchantId,
      period as 'daily' | 'weekly' | 'monthly',
      currentPeriodKey as string,
      previousPeriodKey as string,
    );
    return res.json({ performance });
  }),
);

// ─── GET /admin/merchant-analytics/:merchantId/periods ──────────────
// List available period keys for a merchant

router.get(
  '/admin/merchant-analytics/:merchantId/periods',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { merchantId } = req.params;
    const { period } = req.query;

    if (!period || !['daily', 'weekly', 'monthly'].includes(period as string)) {
      return res.status(400).json({ error: 'Invalid or missing period.' });
    }

    const periods = await merchantAnalytics.getPeriodKeys(
      merchantId,
      period as 'daily' | 'weekly' | 'monthly',
    );
    return res.json({ periods });
  }),
);

export default router;
