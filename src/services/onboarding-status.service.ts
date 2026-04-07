/**
 * Generates an HTML status page for merchant onboarding applications.
 */

export interface ApplicationStatus {
  businessName: string;
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'suspended';
  submittedAt: string;
  updatedAt: string;
  notes?: string;
  steps: Array<{
    name: string;
    status: 'completed' | 'current' | 'pending';
  }>;
}

export function renderOnboardingStatusHtml(app: ApplicationStatus): string {
  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: '#fff3e0', text: '#ef6c00', label: 'Pendiente' },
    in_review: { bg: '#e3f2fd', text: '#1565c0', label: 'En revision' },
    approved: { bg: '#e8f5e9', text: '#2e7d32', label: 'Aprobado' },
    rejected: { bg: '#fce4ec', text: '#c62828', label: 'Rechazado' },
    suspended: { bg: '#f3e5f5', text: '#6a1b9a', label: 'Suspendido' },
  };

  const s = statusColors[app.status] ?? statusColors.pending;

  const stepsHtml = app.steps.map((step) => {
    const icon = step.status === 'completed' ? '&#10003;' : step.status === 'current' ? '&#9679;' : '&#9675;';
    const color = step.status === 'completed' ? '#2e7d32' : step.status === 'current' ? '#1565c0' : '#bbb';
    return `<div style="display:flex;align-items:center;gap:.6rem;margin:.4rem 0">
      <span style="color:${color};font-size:1.2rem;width:24px;text-align:center">${icon}</span>
      <span style="color:${step.status === 'pending' ? '#999' : '#333'}">${esc(step.name)}</span>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estado de Postulacion — ${esc(app.businessName)} — WhatPay</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;padding:2rem;color:#1a1a1a}
    .card{max-width:500px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden}
    .header{background:#075E54;color:#fff;padding:1.5rem;text-align:center}
    .header h1{font-size:1.1rem;margin-bottom:.3rem}
    .header .biz{font-size:1.3rem;font-weight:700}
    .body{padding:1.5rem}
    .status-badge{display:inline-block;padding:.4rem 1rem;border-radius:20px;font-weight:600;font-size:.85rem;
      background:${s.bg};color:${s.text};margin-bottom:1.2rem}
    .dates{font-size:.8rem;color:#999;margin-bottom:1.2rem}
    .steps{margin:1rem 0}
    .steps-title{font-size:.85rem;font-weight:600;color:#555;margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.5px}
    .notes{margin-top:1rem;padding:.8rem;background:#f9f9f9;border-radius:8px;font-size:.85rem;color:#555}
    .footer{text-align:center;padding:1rem;border-top:1px solid #f0f0f0;font-size:.75rem;color:#999}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>WhatPay Merchants</h1>
      <div class="biz">${esc(app.businessName)}</div>
    </div>
    <div class="body">
      <div class="status-badge">${s.label}</div>
      <div class="dates">
        Enviada: ${new Date(app.submittedAt).toLocaleDateString('es-CL')}<br>
        Actualizada: ${new Date(app.updatedAt).toLocaleDateString('es-CL')}
      </div>
      <div class="steps">
        <div class="steps-title">Progreso</div>
        ${stepsHtml}
      </div>
      ${app.notes ? `<div class="notes"><strong>Nota:</strong> ${esc(app.notes)}</div>` : ''}
    </div>
    <div class="footer">WhatPay Chile &mdash; whatpay.cl</div>
  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
