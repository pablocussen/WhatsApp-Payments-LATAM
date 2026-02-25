import { PaymentService } from '../../src/services/payment.service';

const service = new PaymentService();

describe('Fee Calculation', () => {
  it('P2P wallet transfers are free', () => {
    const fee = service.calculateFee(50000, 'WALLET', true);
    expect(fee.fee).toBe(0);
    expect(fee.netAmount).toBe(50000);
    expect(fee.feePercentage).toBe(0);
  });

  it('merchant wallet payments have 1.5% fee', () => {
    const fee = service.calculateFee(100000, 'WALLET', false);
    expect(fee.fee).toBe(1500);
    expect(fee.netAmount).toBe(98500);
    expect(fee.feePercentage).toBe(1.5);
  });

  it('credit card payments have 2.8% + $50 fee', () => {
    const fee = service.calculateFee(100000, 'WEBPAY_CREDIT', false);
    expect(fee.fee).toBe(2850); // 2800 + 50
    expect(fee.netAmount).toBe(97150);
  });

  it('debit card payments have 1.8% + $50 fee', () => {
    const fee = service.calculateFee(100000, 'WEBPAY_DEBIT', false);
    expect(fee.fee).toBe(1850); // 1800 + 50
  });

  it('Khipu payments have 1.0% fee', () => {
    const fee = service.calculateFee(100000, 'KHIPU', false);
    expect(fee.fee).toBe(1000);
    expect(fee.netAmount).toBe(99000);
  });
});

describe('Transaction Limits', () => {
  it('BASIC level: max $50,000 per tx, $200,000 monthly', () => {
    expect(service.validateTransactionLimits(50000, 'BASIC', 0).valid).toBe(true);
    expect(service.validateTransactionLimits(50001, 'BASIC', 0).valid).toBe(false);
    expect(service.validateTransactionLimits(50000, 'BASIC', 160000).valid).toBe(false);
  });

  it('INTERMEDIATE level: max $500,000 per tx, $2,000,000 monthly', () => {
    expect(service.validateTransactionLimits(500000, 'INTERMEDIATE', 0).valid).toBe(true);
    expect(service.validateTransactionLimits(500001, 'INTERMEDIATE', 0).valid).toBe(false);
    expect(service.validateTransactionLimits(500000, 'INTERMEDIATE', 1600000).valid).toBe(false);
  });

  it('FULL level: max $2,000,000 per tx', () => {
    expect(service.validateTransactionLimits(2000000, 'FULL', 0).valid).toBe(true);
    expect(service.validateTransactionLimits(2000001, 'FULL', 0).valid).toBe(false);
  });

  it('rejects amounts below minimum', () => {
    expect(service.validateTransactionLimits(99, 'BASIC', 0).valid).toBe(false);
    expect(service.validateTransactionLimits(100, 'BASIC', 0).valid).toBe(true);
  });
});

describe('Reference Generation', () => {
  it('generates unique references', () => {
    const refs = new Set(Array.from({ length: 50 }, () => service.generateReference()));
    expect(refs.size).toBe(50);
  });

  it('references have correct format', () => {
    const ref = service.generateReference();
    expect(ref).toMatch(/^#WP-\d{4}-[A-F0-9]{8}$/);
  });
});

describe('Amount Formatting', () => {
  it('formats CLP amounts', () => {
    expect(service.formatAmount(15000)).toContain('15.000');
    expect(service.formatAmount(0)).toContain('0');
  });
});

describe('Payment Link Code Generation', () => {
  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => service.generatePaymentLinkCode()));
    expect(codes.size).toBe(100);
  });

  it('generates codes of correct length', () => {
    const code = service.generatePaymentLinkCode();
    expect(code.length).toBeGreaterThanOrEqual(5);
  });
});
