import { formatCLP, formatPhone, normalizePhone, divider, receipt } from '../../src/utils/format';

describe('Currency Formatting', () => {
  it('formats CLP amounts', () => {
    expect(formatCLP(0)).toContain('0');
    expect(formatCLP(1000)).toContain('1.000');
    expect(formatCLP(15000)).toContain('15.000');
    expect(formatCLP(1500000)).toContain('1.500.000');
  });

  it('handles bigint amounts', () => {
    expect(formatCLP(BigInt(25000))).toContain('25.000');
  });
});

describe('Phone Formatting', () => {
  it('formats Chilean phone numbers', () => {
    expect(formatPhone('56912345678')).toBe('+56 9 1234 5678');
    expect(formatPhone('+56912345678')).toBe('+56 9 1234 5678');
  });

  it('returns non-Chilean numbers as-is', () => {
    expect(formatPhone('1234567890')).toBe('1234567890');
  });
});

describe('Phone Normalization', () => {
  it('normalizes Chilean phone formats', () => {
    expect(normalizePhone('+56 9 1234 5678')).toBe('56912345678');
    expect(normalizePhone('56912345678')).toBe('56912345678');
    expect(normalizePhone('912345678')).toBe('56912345678');
    expect(normalizePhone('+56-9-1234-5678')).toBe('56912345678');
  });
});

describe('Message Templates', () => {
  it('creates divider', () => {
    const d = divider();
    expect(d.length).toBeGreaterThan(10);
    expect(d).toContain('─');
  });

  it('creates receipt', () => {
    const r = receipt(['Line 1', 'Line 2']);
    expect(r).toContain('Line 1');
    expect(r).toContain('Line 2');
    expect(r).toContain('─');
  });
});
