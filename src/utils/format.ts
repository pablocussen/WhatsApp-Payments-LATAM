// ─── Currency Formatting ────────────────────────────────

export function formatCLP(amount: number | bigint): string {
  const num = typeof amount === 'bigint' ? Number(amount) : amount;
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

// ─── Phone Formatting ───────────────────────────────────

export function formatPhone(phone: string): string {
  // +56912345678 → +56 9 1234 5678
  if (phone.startsWith('56') && phone.length === 11) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}`;
  }
  if (phone.startsWith('+56')) {
    return formatPhone(phone.slice(1));
  }
  return phone;
}

export function normalizePhone(phone: string): string {
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');

  // Add Chile country code if missing
  if (digits.startsWith('9') && digits.length === 9) {
    digits = '56' + digits;
  }
  if (digits.startsWith('569') && digits.length === 11) {
    return digits;
  }

  return digits;
}

// ─── Date Formatting ────────────────────────────────────

export function formatDateCL(date: Date): string {
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'hace un momento';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} hrs`;
  if (seconds < 2592000) return `hace ${Math.floor(seconds / 86400)} días`;
  return formatDateCL(date);
}

// ─── Message Templates ──────────────────────────────────

export function divider(): string {
  return '────────────────────';
}

export function receipt(lines: string[]): string {
  return [divider(), ...lines, divider()].join('\n');
}
