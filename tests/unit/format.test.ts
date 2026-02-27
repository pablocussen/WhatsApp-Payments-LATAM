import {
  formatCLP,
  formatPhone,
  normalizePhone,
  formatDateCL,
  timeAgo,
  divider,
  receipt,
} from '../../src/utils/format';

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

describe('Date Formatting', () => {
  it('formats a date in Chilean locale (includes year)', () => {
    const date = new Date('2025-06-15T14:30:00.000Z');
    const formatted = formatDateCL(date);
    expect(formatted).toContain('2025');
  });
});

describe('Time Ago', () => {
  it('returns "hace un momento" for very recent events', () => {
    expect(timeAgo(new Date(Date.now() - 5000))).toBe('hace un momento');
  });

  it('returns minutes for events < 1 hour ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(timeAgo(fiveMinAgo)).toMatch(/hace \d+ min/);
  });

  it('returns hours for events 1-24 hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    expect(timeAgo(twoHoursAgo)).toMatch(/hace \d+ hrs/);
  });

  it('returns days for events 1-30 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(timeAgo(threeDaysAgo)).toMatch(/hace \d+ días/);
  });

  it('falls back to full date for events > 30 days ago', () => {
    const twoMonthsAgo = new Date(Date.now() - 65 * 86400 * 1000);
    const result = timeAgo(twoMonthsAgo);
    // Should contain a year (falls through to formatDateCL)
    expect(result).toMatch(/20\d\d/);
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
