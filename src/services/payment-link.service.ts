import { prisma } from '../config/database';
import { createLogger } from '../config/logger';
import { generateShortCode } from '../utils/crypto';
import { formatCLP } from '../utils/format';
import { env } from '../config/environment';

const log = createLogger('payment-link-service');

// ─── Types ──────────────────────────────────────────────

export interface CreateLinkInput {
  merchantId: string;
  amount?: number; // null = open amount
  description?: string;
  expiresInHours?: number; // default 24
  maxUses?: number; // default 1
}

export interface PaymentLinkInfo {
  id: string;
  shortCode: string;
  url: string;
  amount: number | null;
  amountFormatted: string | null;
  description: string | null;
  expiresAt: Date | null;
  isActive: boolean;
  usesRemaining: number;
  merchantName: string | null;
}

// ─── Payment Link Service ───────────────────────────────

export class PaymentLinkService {
  async createLink(input: CreateLinkInput): Promise<PaymentLinkInfo> {
    const shortCode = generateShortCode(6);
    const expiresAt = input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // default 24h

    const link = await prisma.paymentLink.create({
      data: {
        merchantId: input.merchantId,
        shortCode,
        amount: input.amount ? BigInt(input.amount) : null,
        description: input.description || null,
        expiresAt,
        maxUses: input.maxUses || 1,
      },
      include: {
        merchant: { select: { name: true } },
      },
    });

    const url = `${env.PAYMENT_LINK_BASE_URL}/${shortCode}`;

    log.info('Payment link created', {
      linkId: link.id,
      shortCode,
      amount: input.amount,
      merchantId: input.merchantId,
    });

    return {
      id: link.id,
      shortCode,
      url,
      amount: input.amount || null,
      amountFormatted: input.amount ? formatCLP(input.amount) : null,
      description: link.description,
      expiresAt: link.expiresAt,
      isActive: true,
      usesRemaining: link.maxUses - link.currentUses,
      merchantName: link.merchant.name,
    };
  }

  async resolveLink(shortCode: string): Promise<PaymentLinkInfo | null> {
    const link = await prisma.paymentLink.findUnique({
      where: { shortCode },
      include: {
        merchant: { select: { name: true, waId: true } },
      },
    });

    if (!link) return null;

    // Check if expired
    if (link.expiresAt && new Date() > link.expiresAt) {
      return null;
    }

    // Check if max uses reached
    if (link.currentUses >= link.maxUses) {
      return null;
    }

    if (!link.isActive) return null;

    return {
      id: link.id,
      shortCode: link.shortCode,
      url: `${env.PAYMENT_LINK_BASE_URL}/${link.shortCode}`,
      amount: link.amount ? Number(link.amount) : null,
      amountFormatted: link.amount ? formatCLP(Number(link.amount)) : null,
      description: link.description,
      expiresAt: link.expiresAt,
      isActive: link.isActive,
      usesRemaining: link.maxUses - link.currentUses,
      merchantName: link.merchant.name,
    };
  }

  async incrementUse(linkId: string): Promise<void> {
    await prisma.paymentLink.update({
      where: { id: linkId },
      data: { currentUses: { increment: 1 } },
    });
  }

  async deactivateLink(linkId: string, merchantId: string): Promise<boolean> {
    const link = await prisma.paymentLink.findUnique({ where: { id: linkId } });
    if (!link || link.merchantId !== merchantId) return false;

    await prisma.paymentLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });

    return true;
  }

  async getMerchantLinks(merchantId: string, limit = 10): Promise<PaymentLinkInfo[]> {
    const links = await prisma.paymentLink.findMany({
      where: { merchantId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        merchant: { select: { name: true } },
      },
    });

    return links.map((link: (typeof links)[number]) => ({
      id: link.id,
      shortCode: link.shortCode,
      url: `${env.PAYMENT_LINK_BASE_URL}/${link.shortCode}`,
      amount: link.amount ? Number(link.amount) : null,
      amountFormatted: link.amount ? formatCLP(Number(link.amount)) : null,
      description: link.description,
      expiresAt: link.expiresAt,
      isActive: link.isActive,
      usesRemaining: link.maxUses - link.currentUses,
      merchantName: link.merchant.name,
    }));
  }
}
