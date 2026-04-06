/**
 * CSV export utility tests.
 */

import { generateCsv, TRANSACTION_COLUMNS } from '../../src/utils/csv-export';

describe('generateCsv', () => {
  it('generates header and data rows', () => {
    const csv = generateCsv([
      { name: 'Juan', amount: 5000 },
      { name: 'María', amount: 3000 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('name,amount');
    expect(lines[1]).toBe('Juan,5000');
    expect(lines[2]).toBe('María,3000');
  });

  it('uses custom column labels', () => {
    const csv = generateCsv(
      [{ ref: 'WP-001', amt: 5000 }],
      [{ key: 'ref', label: 'Referencia' }, { key: 'amt', label: 'Monto' }],
    );
    expect(csv).toContain('Referencia,Monto');
    expect(csv).toContain('WP-001,5000');
  });

  it('returns empty string for empty rows', () => {
    expect(generateCsv([])).toBe('');
  });

  it('escapes fields with commas', () => {
    const csv = generateCsv([{ desc: 'Café, almuerzo', amount: 5000 }]);
    expect(csv).toContain('"Café, almuerzo"');
  });

  it('escapes fields with quotes', () => {
    const csv = generateCsv([{ desc: 'Dice "hola"', amount: 1000 }]);
    expect(csv).toContain('"Dice ""hola"""');
  });

  it('escapes fields with newlines', () => {
    const csv = generateCsv([{ desc: 'Línea 1\nLínea 2', amount: 2000 }]);
    expect(csv).toContain('"Línea 1\nLínea 2"');
  });

  it('handles null and undefined values', () => {
    const csv = generateCsv([{ name: null, amount: undefined }]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(',');
  });

  it('TRANSACTION_COLUMNS has required fields', () => {
    expect(TRANSACTION_COLUMNS.length).toBeGreaterThanOrEqual(8);
    const keys = TRANSACTION_COLUMNS.map(c => c.key);
    expect(keys).toContain('reference');
    expect(keys).toContain('amount');
    expect(keys).toContain('status');
    expect(keys).toContain('date');
  });

  it('uses CRLF line endings (RFC 4180)', () => {
    const csv = generateCsv([{ a: 1 }, { a: 2 }]);
    expect(csv).toContain('\r\n');
    expect(csv).not.toMatch(/[^\r]\n/); // no bare LF
  });
});
