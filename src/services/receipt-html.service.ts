import { type Receipt } from './receipt.service';
import { formatCLP, formatDateCL } from '../utils/format';

/**
 * Generates a printable HTML receipt from a Receipt object.
 * Users can print to PDF from their browser.
 */
export function renderReceiptHtml(receipt: Receipt): string {
  const typeLabel = getTypeLabel(receipt.type);
  const date = formatDateCL(new Date(receipt.createdAt));
  const feeSection = receipt.fee > 0
    ? `<tr><td>Comision</td><td class="amount">${formatCLP(receipt.fee)}</td></tr>
       <tr><td>Neto</td><td class="amount">${formatCLP(receipt.netAmount)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comprobante ${receipt.reference} — WhatPay</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#f5f5f5;color:#1a1a1a;padding:2rem}
    .receipt{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;
      box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden}
    .header{background:#075E54;color:#fff;padding:1.5rem;text-align:center}
    .header h1{font-size:1.2rem;font-weight:700;margin-bottom:.3rem}
    .header .type{font-size:.85rem;opacity:.8;text-transform:uppercase;letter-spacing:1px}
    .body{padding:1.5rem}
    .ref{text-align:center;font-family:monospace;font-size:.85rem;color:#667;
      margin-bottom:1.2rem;padding-bottom:1rem;border-bottom:1px dashed #ddd}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.2rem}
    .party label{display:block;font-size:.7rem;text-transform:uppercase;color:#999;
      letter-spacing:.5px;margin-bottom:.2rem}
    .party .name{font-weight:600;font-size:.95rem}
    .party .phone{font-size:.8rem;color:#667}
    table{width:100%;border-collapse:collapse;margin:1rem 0}
    td{padding:.5rem 0;font-size:.9rem;border-bottom:1px solid #f0f0f0}
    td.amount{text-align:right;font-weight:600;font-family:monospace}
    tr.total td{border-top:2px solid #075E54;border-bottom:none;font-size:1.1rem;
      font-weight:700;padding-top:.8rem}
    .status{text-align:center;margin:1rem 0;padding:.5rem;border-radius:6px;
      font-size:.85rem;font-weight:600}
    .status.completed{background:#e8f5e9;color:#2e7d32}
    .status.pending{background:#fff3e0;color:#ef6c00}
    .status.failed{background:#fce4ec;color:#c62828}
    .footer{text-align:center;padding:1rem 1.5rem;border-top:1px solid #f0f0f0;
      font-size:.75rem;color:#999}
    .footer .logo{font-weight:700;color:#075E54}
    .print-btn{display:block;width:100%;max-width:480px;margin:1.5rem auto 0;
      padding:.8rem;background:#075E54;color:#fff;border:none;border-radius:8px;
      font-size:.95rem;font-weight:600;cursor:pointer}
    .print-btn:hover{background:#128C7E}
    @media print{
      body{background:#fff;padding:0}
      .receipt{box-shadow:none;border-radius:0}
      .print-btn{display:none}
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>WhatPay</h1>
      <div class="type">Comprobante de ${typeLabel}</div>
    </div>
    <div class="body">
      <div class="ref">${receipt.reference}<br>${date}</div>
      <div class="parties">
        <div class="party">
          <label>De</label>
          <div class="name">${esc(receipt.senderName)}</div>
          <div class="phone">${esc(receipt.senderPhone)}</div>
        </div>
        <div class="party">
          <label>Para</label>
          <div class="name">${esc(receipt.receiverName)}</div>
          <div class="phone">${esc(receipt.receiverPhone)}</div>
        </div>
      </div>
      <table>
        <tr><td>Monto</td><td class="amount">${formatCLP(receipt.amount)}</td></tr>
        ${feeSection}
        ${receipt.description ? `<tr><td>Detalle</td><td>${esc(receipt.description)}</td></tr>` : ''}
        <tr><td>Metodo</td><td>${esc(receipt.paymentMethod)}</td></tr>
        <tr class="total"><td>Total</td><td class="amount">${formatCLP(receipt.netAmount)}</td></tr>
      </table>
      <div class="status ${receipt.status.toLowerCase()}">${receipt.status}</div>
    </div>
    <div class="footer">
      <div class="logo">WhatPay Chile</div>
      Pagos por WhatsApp &mdash; whatpay.cl<br>
      ID: ${receipt.id}
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">Imprimir / Descargar PDF</button>
</body>
</html>`;
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'payment': return 'Pago';
    case 'topup': return 'Recarga';
    case 'refund': return 'Devolucion';
    case 'subscription': return 'Suscripcion';
    default: return 'Transaccion';
  }
}

/** Escape HTML special characters to prevent XSS. */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
