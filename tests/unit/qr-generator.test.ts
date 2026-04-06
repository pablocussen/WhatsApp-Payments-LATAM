/**
 * QR code generator utility tests.
 */

import { generateQrSvgUrl, generateQrHtml } from '../../src/utils/qr-generator';

describe('qr-generator', () => {
  describe('generateQrSvgUrl', () => {
    it('returns a Google Charts URL', () => {
      const url = generateQrSvgUrl('https://whatpay.cl/c/ABC123');
      expect(url).toContain('chart.googleapis.com');
      expect(url).toContain('qr');
    });

    it('encodes the data in the URL', () => {
      const url = generateQrSvgUrl('https://example.com/pay?amount=5000');
      expect(url).toContain(encodeURIComponent('https://example.com/pay?amount=5000'));
    });

    it('sets 300x300 size', () => {
      const url = generateQrSvgUrl('test');
      expect(url).toContain('300x300');
    });
  });

  describe('generateQrHtml', () => {
    it('generates HTML with img tag', () => {
      const html = generateQrHtml('https://whatpay.cl/c/XYZ');
      expect(html).toContain('<img');
      expect(html).toContain('QR Code');
    });

    it('includes the URL in the output', () => {
      const html = generateQrHtml('https://whatpay.cl/c/XYZ');
      expect(html).toContain('whatpay.cl/c/XYZ');
    });

    it('includes optional label', () => {
      const html = generateQrHtml('https://whatpay.cl/c/XYZ', '$5.000');
      expect(html).toContain('$5.000');
    });

    it('omits label paragraph when not provided', () => {
      const html = generateQrHtml('https://whatpay.cl/c/XYZ');
      // Only 2 <p> tags (URL display), not 3 (label + URL)
      const pCount = (html.match(/<p /g) || []).length;
      expect(pCount).toBe(1);
    });

    it('escapes HTML in label', () => {
      const html = generateQrHtml('https://example.com', '<script>alert(1)</script>');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in URL display', () => {
      const html = generateQrHtml('https://example.com/<test>');
      expect(html).toContain('&lt;test&gt;');
    });
  });
});
