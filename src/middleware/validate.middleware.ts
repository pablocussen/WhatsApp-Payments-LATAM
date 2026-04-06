import { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';

/**
 * Middleware factory that validates request body against a Zod schema.
 * Returns 400 with structured error details on validation failure.
 *
 * Usage:
 *   router.post('/endpoint', validate(mySchema), handler);
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.flatten();
      return res.status(400).json({
        error: 'Datos inválidos.',
        details: {
          fieldErrors: errors.fieldErrors,
          formErrors: errors.formErrors,
        },
      });
    }

    // Replace body with parsed (type-coerced, defaults applied) data
    req.body = result.data;
    return next();
  };
}

/**
 * Middleware factory that validates query parameters.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        error: 'Parámetros inválidos.',
        details: result.error.flatten().fieldErrors,
      });
    }

    req.query = result.data;
    return next();
  };
}

// ─── Common Schemas ────────────────────────────────────

export const schemas = {
  /** Chilean phone number */
  phone: z.string().regex(/^\+?56\d{9}$/, 'Número chileno inválido (ej: +56912345678)'),

  /** CLP amount (integer, 100-2M) */
  clpAmount: z.number().int().min(100, 'Mínimo $100').max(2_000_000, 'Máximo $2.000.000'),

  /** 6-digit PIN */
  pin: z.string().length(6, 'PIN debe ser de 6 dígitos').regex(/^\d{6}$/, 'Solo dígitos'),

  /** UUID */
  uuid: z.string().uuid('ID inválido'),

  /** Pagination */
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),

  /** Payment request body */
  payment: z.object({
    receiverId: z.string().min(1, 'receiverId requerido'),
    amount: z.number().int().min(100).max(2_000_000),
    paymentMethod: z.enum(['WALLET', 'WEBPAY_CREDIT', 'WEBPAY_DEBIT', 'KHIPU']),
    description: z.string().max(500).optional(),
    paymentLinkId: z.string().optional(),
  }),

  /** Batch payment */
  batchPayment: z.object({
    items: z.array(z.object({
      receiverId: z.string().min(1),
      receiverName: z.string().min(1),
      amount: z.number().int().min(100).max(2_000_000),
      description: z.string().max(500).optional(),
    })).min(1, 'Mínimo 1 pago').max(50, 'Máximo 50 pagos'),
  }),

  /** Split payment */
  splitPayment: z.object({
    creatorName: z.string().min(1),
    description: z.string().min(1).max(500),
    totalAmount: z.number().int().min(1000),
    splitMethod: z.enum(['equal', 'custom']),
    participants: z.array(z.object({
      phone: z.string().min(8),
      name: z.string().min(1),
      amount: z.number().int().optional(),
    })).min(1).max(20),
  }),

  /** Payment request */
  paymentRequest: z.object({
    requesterName: z.string().min(1),
    requesterPhone: z.string().min(8),
    targetPhone: z.string().min(8),
    targetName: z.string().optional(),
    amount: z.number().int().min(100).max(2_000_000),
    description: z.string().min(1).max(500),
    expiresInHours: z.number().int().min(1).max(720).default(72),
  }),

  /** Scheduled transfer */
  scheduledTransfer: z.object({
    receiverPhone: z.string().min(8),
    receiverName: z.string().min(1),
    amount: z.number().int().min(100).max(2_000_000),
    description: z.string().min(1).max(500),
    frequency: z.enum(['once', 'weekly', 'biweekly', 'monthly']),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato: YYYY-MM-DD'),
    scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
};
