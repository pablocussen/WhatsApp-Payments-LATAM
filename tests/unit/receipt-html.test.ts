/**
 * Receipt HTML generation tests.
 */

import { renderReceiptHtml } from '../../src/services/receipt-html.service';
import { type Receipt } from '../../src/services/receipt.service';

const sampleReceipt: Receipt = {
  id: 'rcp_abc123',
  type: 'payment',
  reference: '#WP-2026-TEST001',
  senderName: 'Juan Pérez',
  senderPhone: '56912345678',
  receiverName: 'María López',
  receiverPhone: '56987654321',
  amount: 15000,
  fee: 0,
  netAmount: 15000,
  description: 'Almuerzo',
  paymentMethod: 'WALLET',
  status: 'COMPLETED',
  createdAt: '2026-04-03T12:00:00.000Z',
  formattedText: '',
};

describe('renderReceiptHtml', () => {
  it('generates valid HTML document', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<title>');
  });

  it('includes receipt reference in title', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('#WP-2026-TEST001');
  });

  it('includes sender and receiver names', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('Juan P');
    expect(html).toContain('Mar');
  });

  it('includes formatted amount', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('$15.000');
  });

  it('includes description', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('Almuerzo');
  });

  it('includes payment method', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('WALLET');
  });

  it('includes receipt ID in footer', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('rcp_abc123');
  });

  it('shows fee section when fee > 0', () => {
    const withFee: Receipt = { ...sampleReceipt, fee: 420, netAmount: 14580 };
    const html = renderReceiptHtml(withFee);
    expect(html).toContain('$420');
    expect(html).toContain('$14.580');
    expect(html).toContain('Comision');
  });

  it('hides fee section when fee is 0', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).not.toContain('Comision');
  });

  it('includes print button', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('window.print()');
    expect(html).toContain('Imprimir');
  });

  it('hides print button in print media query', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('@media print');
    expect(html).toContain('display:none');
  });

  it('escapes HTML in user input (XSS prevention)', () => {
    const xssReceipt: Receipt = {
      ...sampleReceipt,
      senderName: '<script>alert("xss")</script>',
      description: '<img onerror=alert(1) src=x>',
    };
    const html = renderReceiptHtml(xssReceipt);
    // Script tags are escaped — no executable HTML
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('renders different receipt types', () => {
    const topup: Receipt = { ...sampleReceipt, type: 'topup' };
    const refund: Receipt = { ...sampleReceipt, type: 'refund' };

    expect(renderReceiptHtml(topup)).toContain('Recarga');
    expect(renderReceiptHtml(refund)).toContain('Devolucion');
  });

  it('handles null description gracefully', () => {
    const noDesc: Receipt = { ...sampleReceipt, description: null };
    const html = renderReceiptHtml(noDesc);
    expect(html).not.toContain('Detalle');
    expect(html).toContain('<!DOCTYPE html>'); // still valid
  });

  it('includes WhatPay branding', () => {
    const html = renderReceiptHtml(sampleReceipt);
    expect(html).toContain('WhatPay Chile');
    expect(html).toContain('whatpay.cl');
    expect(html).toContain('#075E54'); // WhatPay green
  });
});
