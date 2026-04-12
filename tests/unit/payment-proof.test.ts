/**
 * PaymentProofService — certificados digitales de pago verificables.
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

import { PaymentProofService } from '../../src/services/payment-proof.service';

describe('PaymentProofService', () => {
  let service: PaymentProofService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentProofService();
    mockRedisGet.mockResolvedValue(null);
  });

  const sampleData = {
    senderId: 'u1', senderPhone: '+56912345678',
    receiverId: 'u2', receiverPhone: '+56987654321',
    amount: 15000, reference: '#WP-2026-ABC',
  };

  it('generates proof with unique ID and hash', () => {
    const proof = service.generateProof(sampleData);
    expect(proof.id).toMatch(/^proof_/);
    expect(proof.hash).toHaveLength(64);
    expect(proof.amount).toBe(15000);
    expect(proof.reference).toBe('#WP-2026-ABC');
  });

  it('generates different hashes for different proofs', () => {
    const p1 = service.generateProof(sampleData);
    const p2 = service.generateProof({ ...sampleData, amount: 20000 });
    expect(p1.hash).not.toBe(p2.hash);
  });

  it('sets expiry to 1 year', () => {
    const proof = service.generateProof(sampleData);
    const expiry = new Date(proof.expiresAt);
    const now = new Date();
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(360);
    expect(diffDays).toBeLessThan(370);
  });

  it('saves proof to Redis', async () => {
    const proof = service.generateProof(sampleData);
    await service.saveProof(proof);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('retrieves saved proof', async () => {
    const proof = service.generateProof(sampleData);
    mockRedisGet.mockResolvedValue(JSON.stringify(proof));
    const retrieved = await service.getProof(proof.id);
    expect(retrieved?.id).toBe(proof.id);
    expect(retrieved?.hash).toBe(proof.hash);
  });

  it('returns null for non-existent proof', async () => {
    expect(await service.getProof('proof_nope')).toBeNull();
  });

  it('verifies valid proof', () => {
    const proof = service.generateProof(sampleData);
    expect(service.verifyProof(proof)).toBe(true);
  });

  it('detects tampered proof', () => {
    const proof = service.generateProof(sampleData);
    proof.amount = 999999;
    expect(service.verifyProof(proof)).toBe(false);
  });

  it('detects non-expired proof', () => {
    const proof = service.generateProof(sampleData);
    expect(service.isExpired(proof)).toBe(false);
  });

  it('detects expired proof', () => {
    const proof = service.generateProof(sampleData);
    proof.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(service.isExpired(proof)).toBe(true);
  });

  it('formats for WhatsApp', () => {
    const proof = service.generateProof(sampleData);
    const msg = service.formatForWhatsApp(proof);
    expect(msg).toContain('Comprobante WhatPay');
    expect(msg).toContain('#WP-2026-ABC');
    expect(msg).toContain('$15.000');
    expect(msg).toContain('+56912345678');
    expect(msg).toContain('whatpay.cl/verify/');
  });

  it('formats certificate', () => {
    const proof = service.generateProof({ ...sampleData, description: 'Almuerzo' });
    const cert = service.formatCertificate(proof);
    expect(cert).toContain('CERTIFICADO DE PAGO');
    expect(cert).toContain('$15.000');
    expect(cert).toContain('Almuerzo');
    expect(cert).toContain('Hash:');
  });
});
