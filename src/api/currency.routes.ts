import { Router } from 'express';
import type { Response, Request } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { currency } from '../services/currency.service';
import type { SupportedCurrency } from '../services/currency.service';

const router = Router();

// ─── GET /currency/supported ───────────────────────────

router.get(
  '/currency/supported',
  asyncHandler(async (_req: Request, res: Response) => {
    const currencies = await currency.getSupportedCurrencies();
    return res.json({ currencies });
  }),
);

// ─── GET /currency/rates ───────────────────────────────

router.get(
  '/currency/rates',
  asyncHandler(async (_req: Request, res: Response) => {
    const rates = await currency.getRates();
    return res.json({ rates });
  }),
);

// ─── GET /currency/convert ─────────────────────────────

router.get(
  '/currency/convert',
  asyncHandler(async (req: Request, res: Response) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const amountStr = req.query.amount as string | undefined;

    if (!from || !to || !amountStr) {
      return res.status(400).json({ error: 'Parámetros from, to y amount requeridos.' });
    }

    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Monto inválido.' });
    }

    try {
      const result = await currency.convert(amount, from as SupportedCurrency, to as SupportedCurrency);
      return res.json({ result });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

export default router;
