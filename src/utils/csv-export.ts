/**
 * CSV export utility — generates RFC 4180 compliant CSV.
 */

/**
 * Escape a CSV field. Wraps in quotes if it contains comma, newline, or quote.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV string from an array of objects.
 * Uses the keys of the first object as headers.
 */
export function generateCsv(
  rows: Record<string, unknown>[],
  columns?: { key: string; label: string }[],
): string {
  if (rows.length === 0) return '';

  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));

  // Header row
  const header = cols.map((c) => escapeField(c.label)).join(',');

  // Data rows
  const dataRows = rows.map((row) =>
    cols.map((c) => escapeField(row[c.key])).join(','),
  );

  return [header, ...dataRows].join('\r\n');
}

/**
 * Standard columns for transaction CSV export.
 */
export const TRANSACTION_COLUMNS = [
  { key: 'reference', label: 'Referencia' },
  { key: 'date', label: 'Fecha' },
  { key: 'type', label: 'Tipo' },
  { key: 'amount', label: 'Monto (CLP)' },
  { key: 'fee', label: 'Comision (CLP)' },
  { key: 'net', label: 'Neto (CLP)' },
  { key: 'status', label: 'Estado' },
  { key: 'counterparty', label: 'Contraparte' },
  { key: 'description', label: 'Descripcion' },
  { key: 'paymentMethod', label: 'Metodo' },
];
