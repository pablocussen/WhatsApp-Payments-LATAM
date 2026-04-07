/**
 * Onboarding status HTML page tests.
 */

import { renderOnboardingStatusHtml, type ApplicationStatus } from '../../src/services/onboarding-status.service';

const sampleApp: ApplicationStatus = {
  businessName: 'Cafe La Esquina',
  status: 'in_review',
  submittedAt: '2026-04-01T10:00:00Z',
  updatedAt: '2026-04-03T15:30:00Z',
  notes: 'Pendiente verificacion de RUT comercial',
  steps: [
    { name: 'Datos del negocio', status: 'completed' },
    { name: 'Documentos legales', status: 'completed' },
    { name: 'Verificacion de identidad', status: 'current' },
    { name: 'Aprobacion final', status: 'pending' },
  ],
};

describe('renderOnboardingStatusHtml', () => {
  it('generates valid HTML', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes business name', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('Cafe La Esquina');
  });

  it('shows correct status label', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('En revision');
  });

  it('renders all steps', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('Datos del negocio');
    expect(html).toContain('Documentos legales');
    expect(html).toContain('Verificacion de identidad');
    expect(html).toContain('Aprobacion final');
  });

  it('uses checkmarks for completed steps', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('&#10003;'); // checkmark
  });

  it('includes notes when present', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('verificacion de RUT');
  });

  it('omits notes section when not present', () => {
    const noNotes = { ...sampleApp, notes: undefined };
    const html = renderOnboardingStatusHtml(noNotes);
    expect(html).not.toContain('Nota:');
  });

  it('renders approved status correctly', () => {
    const approved = { ...sampleApp, status: 'approved' as const };
    const html = renderOnboardingStatusHtml(approved);
    expect(html).toContain('Aprobado');
    expect(html).toContain('#2e7d32'); // green
  });

  it('renders rejected status correctly', () => {
    const rejected = { ...sampleApp, status: 'rejected' as const };
    const html = renderOnboardingStatusHtml(rejected);
    expect(html).toContain('Rechazado');
    expect(html).toContain('#c62828'); // red
  });

  it('escapes HTML in business name (XSS)', () => {
    const xss = { ...sampleApp, businessName: '<script>alert(1)</script>' };
    const html = renderOnboardingStatusHtml(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes WhatPay branding', () => {
    const html = renderOnboardingStatusHtml(sampleApp);
    expect(html).toContain('WhatPay');
    expect(html).toContain('#075E54');
  });
});
