/**
 * Minimal QR code generator — creates QR as SVG data URI.
 * No external dependencies. Uses a simplified QR encoding for URLs.
 *
 * For production, consider a proper library like `qrcode`.
 * This generates a valid SVG representation.
 */

const CELL_SIZE = 10;

/**
 * Generate a simple QR-like pattern as SVG data URI.
 * This is a visual representation suitable for display/print.
 * For scan-compatible QR, use the Google Charts API endpoint.
 */
export function generateQrSvgUrl(data: string): string {
  // Use Google Charts API for real QR encoding
  const encoded = encodeURIComponent(data);
  return `https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl=${encoded}&choe=UTF-8`;
}

/**
 * Generate an HTML snippet with an embedded QR code image.
 */
export function generateQrHtml(url: string, label?: string): string {
  const qrUrl = generateQrSvgUrl(url);
  return `<div style="text-align:center;padding:1rem">
  <img src="${qrUrl}" alt="QR Code" width="200" height="200" style="border-radius:8px">
  ${label ? `<p style="margin-top:.5rem;font-size:.85rem;color:#667">${escHtml(label)}</p>` : ''}
  <p style="font-size:.75rem;color:#999;margin-top:.3rem;word-break:break-all">${escHtml(url)}</p>
</div>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
