import { WhatsAppService } from './whatsapp.service';
import { UserService } from './user.service';
import { WalletService } from './wallet.service';
import { TransactionService } from './transaction.service';
import { PaymentLinkService } from './payment-link.service';
import { KhipuService } from './khipu.service';
import {
  getSession,
  setSession,
  deleteSession,
  getRedis,
  ConversationSession,
} from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP, formatPhone, formatDateCL, divider, receipt } from '../utils/format';
import { validateRut, formatRut, hashPin, verifyPinHash, generateReference } from '../utils/crypto';
import { isSecurePin } from '../middleware/auth.middleware';
import { env } from '../config/environment';
import { notificationPrefs } from './notification-prefs.service';
import { activity } from './activity.service';
import { AuditService } from './audit.service';
import { referral as referralSvc } from './referral.service';
import { loyalty as loyaltySvc } from './loyalty.service';
import { promotions as promoSvc } from './promotion.service';
import { qrPayment } from './qr-payment.service';
import { splitPayment } from './split-payment.service';
import { scheduledTransfer } from './scheduled-transfer.service';
import { paymentRequest } from './payment-request.service';
import { consent } from './consent.service';
import { UserPrefsService } from './user-prefs.service';
import { t, greetingI18n, type Locale } from '../utils/i18n';

const log = createLogger('bot-service');

// Type-safe accessors for session.data (Record<string, unknown>)
const sd = (data: Record<string, unknown>, key: string): string => (data[key] as string) ?? '';
const sdn = (data: Record<string, unknown>, key: string): number => (data[key] as number) ?? 0;

// ─── Personality: time-aware (Chile TZ), empathetic ──────
const greeting = (name: string | null): string => {
  const hour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }),
    10,
  );
  const n = name ? ` ${name}` : '';
  if (hour >= 6 && hour < 12) return `Buenos días${n}`;
  if (hour >= 12 && hour < 20) return `Buenas tardes${n}`;
  return `Buenas noches${n}`;
};

// ─── Amount parsing (handles $5.000, 5000, 5,000, "5 lucas", "una luca") ───
const parseAmount = (text: string): number => {
  const n = text.trim().toLowerCase();

  // Chilean slang: "una luca" = 1000, "5 lucas" = 5000, "media luca" = 500
  if (/media\s*luca/i.test(n)) return 500;
  if (/^una\s*luca$/i.test(n)) return 1_000;
  const lucasMatch = n.match(/^(\d+(?:[.,]\d+)?)\s*lucas?$/i);
  if (lucasMatch) return Math.round(parseFloat(lucasMatch[1].replace(',', '.')) * 1_000);

  // Chilean slang: "un palo" = 1M, "2 palos" = 2M
  if (/^un\s*palo$/i.test(n)) return 1_000_000;
  const paloMatch = n.match(/^(\d+)\s*palos?$/i);
  if (paloMatch) return parseInt(paloMatch[1], 10) * 1_000_000;

  // "5k" / "10k"
  const kMatch = n.match(/^(\d+)\s*k$/i);
  if (kMatch) return parseInt(kMatch[1], 10) * 1_000;

  // Standard: $5.000, 5000, 5,000
  const cleaned = n.replace(/[$.\s]/g, '').replace(/,/g, '');
  return parseInt(cleaned, 10);
};

// ─── Phone normalization (strip +, -, spaces, leading 0) ─
const normalizePhone = (raw: string): string => {
  let phone = raw.replace(/[\s\-+()]/g, '');
  // Strip leading 0 (common in Chile: 09 1234 5678)
  if (phone.startsWith('0')) phone = phone.slice(1);
  return phone.startsWith('56') ? phone : `56${phone}`;
};

// ─── Conversation States ────────────────────────────────

type State =
  | 'IDLE'
  | 'REGISTER_RUT'
  | 'REGISTER_PIN'
  | 'REGISTER_PIN_CONFIRM'
  | 'PAY_SELECT_RECIPIENT'
  | 'PAY_ENTER_PHONE'
  | 'PAY_ENTER_AMOUNT'
  | 'PAY_CONFIRM'
  | 'PAY_ENTER_PIN'
  | 'CHARGE_ENTER_AMOUNT'
  | 'CHARGE_ENTER_DESCRIPTION'
  | 'CHARGE_SEND_LINK'
  | 'CHARGE_ENTER_PHONE'
  | 'TOPUP_SELECT_AMOUNT'
  | 'TOPUP_CUSTOM_AMOUNT'
  | 'CHANGE_PIN_CURRENT'
  | 'CHANGE_PIN_NEW'
  | 'CHANGE_PIN_CONFIRM'
  | 'KYC_CONFIRM'
  | 'REFUND_CONFIRM'
  | 'REFUND_ENTER_PIN';

// ─── Bot Service (Stateful Conversation Engine) ─────────

export class BotService {
  private wa = new WhatsAppService();
  private users = new UserService();
  private wallets = new WalletService();
  private transactions = new TransactionService();
  private paymentLinks = new PaymentLinkService();
  private khipu = new KhipuService();
  private audit = new AuditService();
  private prefs = new UserPrefsService();

  /** Get user's preferred locale. Defaults to 'es'. */
  private async getLocale(userId?: string): Promise<Locale> {
    if (!userId) return 'es';
    try {
      const p = await this.prefs.getPrefs(userId);
      return p.language ?? 'es';
    } catch { return 'es'; }
  }

  async handleMessage(from: string, text: string, buttonId?: string): Promise<void> {
    try {
      // Get or create session
      const session = await getSession(from);
      const user = await this.users.getUserByWaId(from);

      // ── Not registered → Onboarding (also handles stale non-REGISTER sessions)
      if (!user) {
        if (session && session.state.startsWith('REGISTER')) {
          await this.handleRegistration(from, text, session);
        } else {
          if (session) await deleteSession(from); // clean stale session
          await this.startRegistration(from);
        }
        return;
      }

      // ── Registered user: handle commands or state
      if (user) {
        activity.touch(user.id); // fire-and-forget last-seen update
        // Check for commands first (reset any ongoing flow)
        const command = this.parseCommand(text, buttonId);
        if (command) {
          await this.handleCommand(from, user.id, command, text);
          return;
        }

        // Handle ongoing conversation state
        if (session && session.state !== 'IDLE') {
          await this.handleStatefulFlow(from, user.id, text, session);
          return;
        }

        // Unknown message
        await this.sendHelp(from, user.name, user.id);
      }
    } catch (err) {
      log.error('Bot error', { from, error: (err as Error).message });
      await this.wa.sendButtonMessage(
        from,
        'Ups, algo falló de nuestro lado. Intenta de nuevo en unos segundos.',
        [
          { id: 'cmd_pay', title: 'Enviar dinero' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ],
      );
    }
  }

  // ═══════════════════════════════════════════════════════
  //  REGISTRATION
  // ═══════════════════════════════════════════════════════

  private async startRegistration(from: string): Promise<void> {
    const greet = greeting(null);
    await this.wa.sendButtonMessage(
      from,
      [
        `${greet} 👋`,
        '',
        'Soy *WhatPay*, tu billetera en WhatsApp.',
        '',
        'Envía y recibe plata sin salir del chat.',
        'Crear tu cuenta toma menos de 1 minuto.',
        '',
        'Al crear tu cuenta aceptas nuestros Términos de Servicio y Política de Privacidad:',
        'whatpay.cl/legal',
      ].join('\n'),
      [{ id: 'start_register', title: 'Crear mi cuenta' }],
    );

    await setSession(from, {
      userId: '',
      waId: from,
      state: 'REGISTER_RUT',
      data: {},
      lastActivity: Date.now(),
    });
  }

  private async handleRegistration(
    from: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    switch (session.state as State) {
      case 'REGISTER_RUT': {
        if (text === 'start_register' || text === 'crear mi cuenta') {
          await this.wa.sendTextMessage(from, 'Escribe tu RUT (ej: 12.345.678-9):');
          return;
        }

        const rut = text.replace(/\s/g, '');
        if (!validateRut(rut)) {
          await this.wa.sendTextMessage(from, 'RUT inválido. Intenta de nuevo (ej: 12.345.678-9):');
          return;
        }

        session.data.rut = rut;
        session.state = 'REGISTER_PIN';
        await setSession(from, session);
        await this.wa.sendTextMessage(
          from,
          `RUT ${formatRut(rut)} verificado.\n\nAhora crea un PIN de 6 dígitos para autorizar tus pagos.\nNo lo compartas con nadie.`,
        );
        return;
      }

      case 'REGISTER_PIN': {
        if (text.length !== 6 || !/^\d{6}$/.test(text)) {
          await this.wa.sendTextMessage(from, 'El PIN debe ser de 6 dígitos numéricos:');
          return;
        }
        if (!isSecurePin(text)) {
          await this.wa.sendTextMessage(
            from,
            'PIN muy simple. No uses secuencias (123456) ni repetidos (111111). Elige otro:',
          );
          return;
        }

        session.data.pinHash = await hashPin(text);
        session.state = 'REGISTER_PIN_CONFIRM';
        await setSession(from, session);
        await this.wa.sendTextMessage(from, 'Confirma tu PIN (escríbelo de nuevo):');
        return;
      }

      case 'REGISTER_PIN_CONFIRM': {
        if (!(await verifyPinHash(text, sd(session.data, 'pinHash')))) {
          session.state = 'REGISTER_PIN';
          delete session.data.pinHash;
          await setSession(from, session);
          await this.wa.sendTextMessage(from, 'Los PINs no coinciden. Crea tu PIN de nuevo:');
          return;
        }

        // Create user (text is the confirmed PIN)
        const result = await this.users.createUser({
          waId: from,
          rut: sd(session.data, 'rut'),
          pin: text,
        });

        if (!result.success) {
          await deleteSession(from);
          await this.wa.sendTextMessage(from, result.error || 'Error al crear la cuenta.');
          return;
        }

        await deleteSession(from);

        // Record legal consents (ToS + Privacy + Messaging)
        if (result.userId) {
          consent.grantRegistrationConsents({ userId: result.userId, waId: from }).catch(() => {});
        }

        await this.wa.sendButtonMessage(
          from,
          [
            'Listo, tu cuenta está creada 🎉',
            '',
            '📊 Nivel Básico (hasta $200.000/mes)',
            '💰 Saldo: $0 CLP',
            '',
            'Recarga saldo para hacer tu primer pago.',
          ].join('\n'),
          [
            { id: 'cmd_topup', title: 'Recargar saldo' },
            { id: 'cmd_pay', title: 'Enviar dinero' },
            { id: 'cmd_charge', title: 'Cobrar' },
          ],
        );
        return;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  COMMAND ROUTING
  // ═══════════════════════════════════════════════════════

  private parseCommand(text: string, buttonId?: string): string | null {
    const n = text.trim().toLowerCase();

    // Button IDs from interactive messages
    if (buttonId?.startsWith('cmd_')) return buttonId.replace('cmd_', '');

    // ── Greetings & menu ────────────────────────────────
    if (/^(hola|hey|buenas?|buenos?\s*(d[ií]as?|tardes?|noches?)|hi|hello|qu[eé]\s*tal|menu|men[uú]|inicio|home|ayuda|help|opciones|\?|que\s*puedo\s*hacer)$/i.test(n))
      return 'help';

    // ── Pay ──────────────────────────────────────────────
    if (/^(\/pagar|pagar|enviar\s*(plata|dinero|pago)|transferir|mandar\s*(plata|dinero)|quiero\s*pagar)/i.test(n))
      return 'pay';
    if (n.startsWith('pagar ') || n.startsWith('enviar ')) return 'pay';

    // ── Charge ───────────────────────────────────────────
    if (/^(\/cobrar|cobrar|quiero\s*cobrar|me\s*deben|crear?\s*cobro)/i.test(n))
      return 'charge';
    if (n.startsWith('cobrar ')) return 'charge';

    // ── Balance ──────────────────────────────────────────
    if (/^(\/saldo|saldo|mi\s*saldo|cu[aá]nto\s*tengo|mi\s*plata|billetera|wallet|balance|mi\s*billetera)/i.test(n))
      return 'balance';

    // ── Top-up ───────────────────────────────────────────
    if (/^(\/recargar|recargar|cargar\s*saldo|agregar\s*(plata|fondos|saldo)|quiero\s*recargar)/i.test(n))
      return 'topup';

    // ── History ──────────────────────────────────────────
    if (/^(\/historial|historial|mis\s*pagos|movimientos|[uú]ltimos?\s*pagos?|transacciones)/i.test(n))
      return 'history';

    // ── Profile ──────────────────────────────────────────
    if (/^(\/perfil|perfil|mi\s*perfil|mi\s*cuenta|mis\s*datos|cuenta)/i.test(n))
      return 'profile';

    // ── Support ──────────────────────────────────────────
    if (/^(\/soporte|soporte|ayuda\s*humana|hablar\s*con\s*alguien|contacto|reclamo)/i.test(n))
      return 'support';

    // ── Change PIN ───────────────────────────────────────
    if (/^(\/cambiarpin|cambiar\s*pin|nuevo\s*pin|cambiar\s*clave)/i.test(n))
      return 'changepin';

    // ── KYC ──────────────────────────────────────────────
    if (/^(\/kyc|verificar|subir\s*nivel|aumentar\s*l[ií]mites?|upgrade)/i.test(n))
      return 'kyc';

    // ── Cancel ───────────────────────────────────────────
    if (/^(\/cancelar|cancelar|salir|volver|atr[aá]s|no\s*gracias)/i.test(n))
      return 'cancel';

    // ── Receipt ──────────────────────────────────────────
    if (/^(\/recibo|recibo|comprobante|boleta)/i.test(n)) return 'receipt';
    if (n.startsWith('recibo ') || n.startsWith('comprobante ')) return 'receipt';

    // ── Refund ───────────────────────────────────────────
    if (/^(\/devolver|devolver|devoluci[oó]n|reembolso)/i.test(n)) return 'refund';
    if (n.startsWith('devolver ')) return 'refund';

    // ── Promotions ───────────────────────────────────────
    if (/^(\/promo|promo|descuento|promoci[oó]n|c[oó]digo\s*de\s*descuento)/i.test(n)) return 'promo';
    if (n.startsWith('promo ') || n.startsWith('/promo ')) return 'promo';

    // ── Loyalty / Points ─────────────────────────────────
    if (/^(\/puntos|puntos|mis\s*puntos|puntos\s*wh?at|lealtad|fidelidad|recompensas?|tier|nivel\s*de\s*puntos)/i.test(n))
      return 'points';

    // ── Invite / Referral ────────────────────────────────
    if (/^(\/invitar|invitar|referido|mi\s*c[oó]digo|compartir|c[oó]digo\s*de\s*referido)/i.test(n))
      return 'invite';

    // ── Mute ─────────────────────────────────────────────
    if (/^(\/silenciar|silenciar|silencio|notificaciones)/i.test(n)) return 'mute';

    // ── Quiet hours ──────────────────────────────────────
    if (/^(\/horario|horario\s*silencioso)/i.test(n)) return 'quiethours';
    if (n.startsWith('horario ')) return 'quiethours';

    // ── QR Payment ────────────────────────────────────────
    if (/^(\/qr|qr|c[oó]digo\s*qr|generar\s*qr|crear\s*qr|mi\s*qr)/i.test(n)) return 'qr';

    // ── Split Payment ───────────────────────────────────
    if (/^(\/dividir|dividir|split|dividir\s*cuenta|vamos\s*a\s*dividir|repartir|hacer\s*vaca|la\s*vaca)/i.test(n)) return 'split';

    // ── Scheduled Transfer ──────────────────────────────
    if (/^(\/programar|programar|agendar|pago\s*programado|programar\s*pago|transferencia\s*programada)/i.test(n)) return 'scheduled';

    // ── Payment Request ─────────────────────────────────
    if (/^(\/solicitar|solicitar|pedir\s*plata|solicitar\s*pago|me\s*debes|ped[ií]r\s*dinero)/i.test(n)) return 'request';

    // ── Account Deletion ─────────────────────────────────
    if (/^(\/eliminar|eliminar\s*cuenta|borrar\s*cuenta|delete\s*account|eliminar\s*mis?\s*datos)/i.test(n))
      return 'delete';

    // ── Gratitude → show menu ────────────────────────────
    if (/^(gracias|thanks|vale|listo|genial|ok|dale|perfect[oa]?|buena|bac[aá]n|sipo|ya)$/i.test(n))
      return 'help';

    // ── Fuzzy intent detection (longer phrases) ────────
    if (/necesito\s*(enviar|mandar|transferir|pagar)/i.test(n)) return 'pay';
    if (/quiero\s*ver\s*(mi\s*)?(saldo|plata|billetera)/i.test(n)) return 'balance';
    if (/cu[aá]nta?\s*plata\s*(tengo|me\s*queda)/i.test(n)) return 'balance';
    if (/me\s*(mandaron|enviaron|transfirieron)\s*(plata|dinero)/i.test(n)) return 'history';
    if (/qu[eé]\s*(pagos?|movimientos?)\s*(tengo|hice)/i.test(n)) return 'history';
    if (/necesito\s*plata/i.test(n)) return 'topup';
    if (/c[oó]mo\s*(recargo|cargo|agrego)\s*(saldo|plata)/i.test(n)) return 'topup';

    return null;
  }

  private async handleCommand(
    from: string,
    userId: string,
    command: string,
    rawText: string,
  ): Promise<void> {
    switch (command) {
      case 'pay':
        return this.startPayFlow(from, userId, rawText);
      case 'charge':
        return this.startChargeFlow(from, userId, rawText);
      case 'balance':
        return this.showBalance(from, userId);
      case 'topup':
        return this.startTopUpFlow(from, userId);
      case 'history':
        return this.showHistory(from, userId);
      case 'help': {
        const helpUser = await this.users.getUserByWaId(from);
        return this.sendHelp(from, helpUser?.name ?? null, helpUser?.id);
      }
      case 'support': {
        const sl = await this.getLocale(userId);
        return this.wa.sendTextMessage(
          from,
          [
            t('support.title', sl),
            '',
            t('support.contactUs', sl),
            '',
            '📧 *Email:* soporte@whatpay.cl',
            '🌐 *Web:* whatpay.cl/soporte',
            '📞 *Tel:* +56 2 2345 6789',
            '',
            t('support.hours', sl),
            '',
            t('support.humanAgent', sl),
            '',
            '📋 Terms: whatpay.cl/legal',
            '🔒 Privacy: whatpay.cl/privacidad',
          ].join('\n'),
        );
      }
      case 'profile':
        return this.showProfile(from, userId);
      case 'changepin':
        return this.startChangePinFlow(from, userId);
      case 'kyc':
        return this.startKycUpgradeFlow(from, userId);
      case 'cancel': {
        await deleteSession(from);
        await this.wa.sendButtonMessage(
          from,
          'Operación cancelada.\n\n¿Qué necesitas?',
          [
            { id: 'cmd_pay', title: 'Enviar dinero' },
            { id: 'cmd_charge', title: 'Cobrar' },
            { id: 'cmd_balance', title: 'Mi billetera' },
          ],
        );
        return;
      }
      case 'receipt':
        return this.showReceipt(from, userId, rawText);
      case 'refund':
        return this.startRefundFlow(from, userId, rawText);
      case 'promo':
        return this.showPromo(from, userId, rawText);
      case 'points':
        return this.showPoints(from, userId);
      case 'invite':
        return this.showInvite(from, userId);
      case 'mute':
        return this.toggleMute(from, userId);
      case 'quiethours':
        return this.handleQuietHours(from, userId, rawText);
      case 'qr':
        return this.showQr(from, userId);
      case 'split':
        return this.showSplit(from, userId);
      case 'scheduled':
        return this.showScheduled(from, userId);
      case 'request':
        return this.showRequest(from, userId);
      case 'delete':
        return this.handleDeleteAccount(from, userId);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PAY FLOW (Stateful)
  // ═══════════════════════════════════════════════════════

  private async startPayFlow(from: string, userId: string, rawText?: string): Promise<void> {
    // Quick-pay: pagar 56912345678 5000 / enviar 912345678 10000
    if (rawText) {
      const parts = rawText.replace(/^(\/pagar|pagar|enviar\s*(plata|dinero)?|transferir|mandar\s*(plata|dinero)?|quiero\s*pagar)\s*/i, '').trim().split(/\s+/);
      const quickPhone = parts[0]?.replace(/[\s\-+()]/g, '');
      const quickAmount = parseAmount(parts[1] || '');

      if (quickPhone && /^\d{8,12}$/.test(quickPhone) && !isNaN(quickAmount) && quickAmount >= 100) {
        const normalizedPhone = normalizePhone(quickPhone);
        const receiver = await this.users.getUserByWaId(normalizedPhone);

        if (receiver && receiver.id !== userId) {
          const balance = await this.wallets.getBalance(userId);
          await setSession(from, {
            userId,
            waId: from,
            state: 'PAY_CONFIRM',
            data: {
              receiverId: receiver.id,
              receiverName: receiver.name || formatPhone(normalizedPhone),
              receiverPhone: normalizedPhone,
              amount: quickAmount,
            },
            lastActivity: Date.now(),
          });

          await this.wa.sendButtonMessage(
            from,
            receipt([
              `Para: ${receiver.name || formatPhone(normalizedPhone)}`,
              `Monto: ${formatCLP(quickAmount)}`,
              `Comisión: $0 (P2P gratis)`,
              `Tu saldo: ${balance.formatted}`,
            ]),
            [
              { id: 'confirm_pay', title: 'Confirmar y pagar' },
              { id: 'cmd_cancel', title: 'Cancelar' },
            ],
          );
          return;
        }
      }
    }

    await setSession(from, {
      userId,
      waId: from,
      state: 'PAY_ENTER_PHONE',
      data: {},
      lastActivity: Date.now(),
    });

    // Show recent recipients as quick buttons
    const recent = await this.transactions.getRecentRecipients(userId);

    if (recent.length > 0) {
      const buttons = recent.map((r) => ({
        id: `rcpt_${r.waId}`,
        title: (r.name || formatPhone(r.waId)).slice(0, 20),
      }));
      await this.wa.sendButtonMessage(
        from,
        '¿A quién le quieres pagar?\n\nElige un contacto reciente o escribe un número:',
        buttons,
      );
    } else {
      await this.wa.sendTextMessage(
        from,
        '¿A quién le quieres pagar?\n\nEscribe el número de teléfono (ej: +56912345678):',
      );
    }
  }

  private async handlePayFlow(
    from: string,
    userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    switch (session.state as State) {
      case 'PAY_ENTER_PHONE': {
        // Find receiver — handle rcpt_ button clicks
        const rcptMatch = text.match(/^rcpt_(\d+)$/);
        const rawPhone = rcptMatch ? rcptMatch[1] : text;
        const normalizedPhone = normalizePhone(rawPhone);

        const receiver = await this.users.getUserByWaId(normalizedPhone);
        if (!receiver) {
          await this.wa.sendButtonMessage(
            from,
            `El número ${formatPhone(normalizedPhone)} no tiene WhatPay.`,
            [
              { id: 'cmd_pay', title: 'Otro número' },
              { id: 'cmd_help', title: 'Cancelar' },
            ],
          );
          await deleteSession(from);
          return;
        }

        if (receiver.id === userId) {
          await deleteSession(from);
          await this.wa.sendButtonMessage(
            from,
            'No puedes pagarte a ti mismo.',
            [
              { id: 'cmd_pay', title: 'Otro número' },
              { id: 'cmd_balance', title: 'Mi billetera' },
            ],
          );
          return;
        }

        session.data.receiverId = receiver.id;
        session.data.receiverName = receiver.name || formatPhone(normalizedPhone);
        session.data.receiverPhone = normalizedPhone;
        session.state = 'PAY_ENTER_AMOUNT';
        await setSession(from, session);

        await this.wa.sendButtonMessage(
          from,
          `Pagar a: ${session.data.receiverName}\n\n¿Cuánto quieres enviar?\n(o escribe otro monto en pesos CLP)`,
          [
            { id: 'amt_5000', title: '$5.000' },
            { id: 'amt_10000', title: '$10.000' },
            { id: 'amt_20000', title: '$20.000' },
          ],
        );
        return;
      }

      case 'PAY_ENTER_AMOUNT': {
        // Handle preset amount button clicks (amt_5000)
        const amtMatch = text.match(/^amt_(\d+)$/);
        const amount = amtMatch ? parseInt(amtMatch[1], 10) : parseAmount(text);
        if (isNaN(amount) || amount < 100) {
          await this.wa.sendTextMessage(from, 'Monto inválido. Mínimo $100 CLP. Escribe el monto:');
          return;
        }

        session.data.amount = amount;
        session.state = 'PAY_CONFIRM';
        await setSession(from, session);

        const balance = await this.wallets.getBalance(userId);

        await this.wa.sendButtonMessage(
          from,
          receipt([
            `Para: ${session.data.receiverName}`,
            `Monto: ${formatCLP(amount)}`,
            `Comisión: $0 (P2P gratis)`,
            `Tu saldo: ${balance.formatted}`,
          ]),
          [
            { id: 'confirm_pay', title: 'Confirmar y pagar' },
            { id: 'cmd_cancel', title: 'Cancelar' },
          ],
        );
        return;
      }

      case 'PAY_CONFIRM': {
        if (
          text === 'confirm_pay' ||
          text === 'confirmar y pagar' ||
          text.toLowerCase() === 'si' ||
          text.toLowerCase() === 'sí'
        ) {
          // Proactive balance check — warn before asking for PIN
          const preCheck = await this.wallets.getBalance(userId);
          const payAmount = sdn(session.data, 'amount');
          if (preCheck.balance < payAmount) {
            await deleteSession(from);
            await this.wa.sendButtonMessage(
              from,
              `Saldo insuficiente.\n\nNecesitas *${formatCLP(payAmount)}* pero tienes *${preCheck.formatted}*.\nRecarga tu billetera para continuar.`,
              [
                { id: 'cmd_topup', title: 'Recargar' },
                { id: 'cmd_balance', title: 'Mi billetera' },
              ],
            );
            return;
          }

          session.state = 'PAY_ENTER_PIN';
          await setSession(from, session);
          await this.wa.sendTextMessage(from, 'Ingresa tu PIN de 6 dígitos:');
          return;
        }
        await deleteSession(from);
        await this.wa.sendButtonMessage(from, 'Pago cancelado.', [
          { id: 'cmd_pay', title: 'Nuevo pago' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ]);
        return;
      }

      case 'PAY_ENTER_PIN': {
        // Verify PIN
        const pinResult = await this.users.verifyUserPin(from, text);
        if (!pinResult.success) {
          this.audit.log({
            eventType: 'PIN_FAILED',
            actorType: 'USER',
            actorId: userId,
            targetUserId: userId,
            metadata: { flow: 'PAY', locked: pinResult.isLocked ?? false },
          });
          if (pinResult.isLocked) await deleteSession(from);
          await this.wa.sendTextMessage(from, pinResult.message);
          return;
        }

        // Process payment
        const payment = await this.transactions.processP2PPayment({
          senderId: userId,
          senderWaId: from,
          receiverId: sd(session.data, 'receiverId'),
          amount: sdn(session.data, 'amount'),
          paymentMethod: 'WALLET',
          description: `Pago a ${sd(session.data, 'receiverName')}`,
        });

        await deleteSession(from);

        // Earn loyalty points fire-and-forget (fail-open)
        if (payment.success && payment.reference) {
          loyaltySvc.earnPoints(
            userId,
            sdn(session.data, 'amount'),
            payment.reference,
            `Pago a ${sd(session.data, 'receiverName')}`,
          ).catch(() => { /* fail-open */ });
        }

        if (!payment.success) {
          await this.wa.sendButtonMessage(
            from,
            payment.error || 'No pudimos procesar el pago. Intenta de nuevo.',
            [
              { id: 'cmd_pay', title: 'Reintentar' },
              { id: 'cmd_balance', title: 'Mi billetera' },
            ],
          );
          return;
        }

        const now = formatDateCL(new Date());

        // Notify sender with smart action buttons
        await this.wa.sendButtonMessage(
          from,
          [
            `Pago enviado ✅`,
            receipt([
              `*${formatCLP(sdn(session.data, 'amount'))}* a ${sd(session.data, 'receiverName')}`,
              `Ref: ${payment.reference}`,
              `Fecha: ${now}`,
              `Saldo restante: ${payment.senderBalance}`,
            ]),
          ].join('\n'),
          [
            { id: 'cmd_pay', title: 'Otro pago' },
            { id: 'cmd_balance', title: 'Mi billetera' },
          ],
        );

        // Notify receiver (only if they are a registered user — WhatsApp opt-in compliance)
        const sender = await this.users.getUserByWaId(from);
        const receiverPhone = sd(session.data, 'receiverPhone');
        const receiverUser = await this.users.getUserByWaId(receiverPhone);
        if (receiverUser) {
          await this.wa.sendButtonMessage(
            receiverPhone,
            [
              `Recibiste un pago 💸`,
              receipt([
                `*${formatCLP(sdn(session.data, 'amount'))}* de ${sender?.name || formatPhone(from)}`,
                `Ref: ${payment.reference}`,
                `Fecha: ${now}`,
              ]),
            ].join('\n'),
            [
              { id: 'cmd_balance', title: 'Mi billetera' },
              { id: 'cmd_pay', title: 'Devolver pago' },
            ],
          );
        }

        log.info('P2P payment completed via bot', {
          reference: payment.reference,
          amount: session.data.amount,
        });
        return;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  CHARGE FLOW (Payment Links)
  // ═══════════════════════════════════════════════════════

  private async startChargeFlow(from: string, userId: string, rawText: string): Promise<void> {
    // Quick charge: cobrar 3500 Café
    const parts = rawText
      .replace(/^(\/cobrar|cobrar|quiero\s*cobrar|me\s*deben|crear?\s*cobro)\s*/i, '')
      .trim()
      .split(/\s+/);
    const quickAmount = parseAmount(parts[0] || '');

    if (!isNaN(quickAmount) && quickAmount >= 100) {
      const description = parts.slice(1).join(' ') || 'Pago';
      const link = await this.paymentLinks.createLink({
        merchantId: userId,
        amount: quickAmount,
        description,
      });

      await this.wa.sendTextMessage(
        from,
        [
          'Enlace de cobro creado:',
          receipt([
            `Monto: ${link.amountFormatted}`,
            `Concepto: ${description}`,
            `Enlace: ${link.url}`,
            `Vence: 24 horas`,
          ]),
        ].join('\n'),
      );

      // Offer to send the link to a phone
      await setSession(from, {
        userId,
        waId: from,
        state: 'CHARGE_SEND_LINK',
        data: { linkUrl: link.url, linkAmount: quickAmount, linkDescription: description },
        lastActivity: Date.now(),
      });
      await this.wa.sendButtonMessage(
        from,
        '¿Quieres enviar el cobro a un contacto por WhatsApp?',
        [
          { id: 'charge_send_yes', title: 'Sí, enviar' },
          { id: 'charge_send_no', title: 'No, listo' },
        ],
      );
      return;
    }

    // Interactive charge flow
    await setSession(from, {
      userId,
      waId: from,
      state: 'CHARGE_ENTER_AMOUNT',
      data: {},
      lastActivity: Date.now(),
    });
    await this.wa.sendButtonMessage(
      from,
      '¿Cuánto quieres cobrar?\n(o escribe otro monto en pesos CLP)',
      [
        { id: 'amt_5000', title: '$5.000' },
        { id: 'amt_10000', title: '$10.000' },
        { id: 'amt_20000', title: '$20.000' },
      ],
    );
  }

  private async handleChargeFlow(
    from: string,
    userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    switch (session.state as State) {
      case 'CHARGE_ENTER_AMOUNT': {
        const amtMatch = text.match(/^amt_(\d+)$/);
        const amount = amtMatch ? parseInt(amtMatch[1], 10) : parseAmount(text);
        if (isNaN(amount) || amount < 100 || amount > 50_000_000) {
          await this.wa.sendTextMessage(
            from,
            'Monto inválido. Debe estar entre $100 y $50.000.000. Escribe el monto:',
          );
          return;
        }
        session.data.amount = amount;
        session.state = 'CHARGE_ENTER_DESCRIPTION';
        await setSession(from, session);
        await this.wa.sendTextMessage(from, '¿Concepto del cobro? (ej: "Café con leche"):');
        return;
      }

      case 'CHARGE_ENTER_DESCRIPTION': {
        const description = text.slice(0, 200);
        const amount = sdn(session.data, 'amount');
        const link = await this.paymentLinks.createLink({
          merchantId: userId,
          amount,
          description,
        });

        await this.wa.sendTextMessage(
          from,
          [
            'Enlace de cobro creado:',
            receipt([
              `Monto: ${link.amountFormatted}`,
              `Concepto: ${description}`,
              `Enlace: ${link.url}`,
              `Vence: 24 horas`,
            ]),
          ].join('\n'),
        );

        // Offer to send the link to a phone
        session.state = 'CHARGE_SEND_LINK';
        session.data.linkUrl = link.url;
        session.data.linkAmount = amount;
        session.data.linkDescription = description;
        await setSession(from, session);
        await this.wa.sendButtonMessage(
          from,
          '¿Quieres enviar el cobro a un contacto por WhatsApp?',
          [
            { id: 'charge_send_yes', title: 'Sí, enviar' },
            { id: 'charge_send_no', title: 'No, listo' },
          ],
        );
        return;
      }

      case 'CHARGE_SEND_LINK': {
        const normalized = text.trim().toLowerCase();

        // User declined
        if (
          normalized === 'charge_send_no' ||
          normalized === 'no, listo' ||
          normalized === 'no'
        ) {
          await deleteSession(from);
          await this.wa.sendButtonMessage(from, 'Listo, el enlace de cobro está creado.', [
            { id: 'cmd_charge', title: 'Nuevo cobro' },
            { id: 'cmd_balance', title: 'Mi billetera' },
          ]);
          return;
        }

        // User accepted → ask for phone
        if (
          normalized === 'charge_send_yes' ||
          normalized === 'sí, enviar' ||
          normalized === 'si'
        ) {
          session.state = 'CHARGE_ENTER_PHONE';
          await setSession(from, session);
          await this.wa.sendTextMessage(
            from,
            'Escribe el número de WhatsApp del destinatario (ej: +56912345678):',
          );
          return;
        }

        // User typed a phone number directly — validate and send
        return this.sendChargeToPhone(from, text, session);
      }

      case 'CHARGE_ENTER_PHONE': {
        return this.sendChargeToPhone(from, text, session);
      }
    }
  }

  private async sendChargeToPhone(
    from: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    const normalizedPhone = normalizePhone(text);

    if (!/^\d{10,12}$/.test(normalizedPhone)) {
      await this.wa.sendTextMessage(
        from,
        'Número inválido. Escribe un número chileno (ej: +56912345678):',
      );
      return;
    }

    const merchant = await this.users.getUserByWaId(from);
    const chargeAmount = sdn(session.data, 'linkAmount');
    const chargeDesc = sd(session.data, 'linkDescription');
    const chargeUrl = sd(session.data, 'linkUrl');

    // WhatsApp opt-in compliance: only send business messages to registered users
    // or users who have previously interacted with us
    const targetUser = await this.users.getUserByWaId(normalizedPhone);
    const hasConsent = await consent.hasThirdPartyConsent(normalizedPhone);

    if (!targetUser && !hasConsent) {
      // Cannot send business-initiated message to unknown third party
      await deleteSession(from);
      await this.wa.sendTextMessage(
        from,
        `${formatPhone(normalizedPhone)} no tiene cuenta WhatPay. Comparte el enlace directamente:\n\n${chargeUrl}`,
      );
      return;
    }

    await this.wa.sendButtonMessage(
      normalizedPhone,
      [
        `${merchant?.name || 'Alguien'} te envió un cobro:`,
        receipt([
          `Monto: ${formatCLP(chargeAmount)}`,
          `Concepto: ${chargeDesc}`,
          `Enlace: ${chargeUrl}`,
        ]),
      ].join('\n'),
      [
        { id: `pay_charge_${chargeAmount}`, title: 'Pagar ahora' },
        { id: 'charge_decline', title: 'Rechazar' },
      ],
    );

    // Record contact for future consent tracking
    consent.recordThirdPartyContact(normalizedPhone).catch(() => {});

    await deleteSession(from);
    await this.wa.sendTextMessage(from, `Cobro enviado a ${formatPhone(normalizedPhone)}.`);
  }

  // ═══════════════════════════════════════════════════════
  //  QUICK COMMANDS
  // ═══════════════════════════════════════════════════════

  private async showBalance(from: string, userId: string): Promise<void> {
    const locale = await this.getLocale(userId);
    const balance = await this.wallets.getBalance(userId);
    await this.wa.sendButtonMessage(
      from,
      `${t('balance.title', locale)}\n\n${t('balance.label', locale)}: *${balance.formatted}*`,
      [
        { id: 'cmd_pay', title: t('menu.sendMoney', locale) },
        { id: 'cmd_topup', title: t('balance.topup', locale) },
        { id: 'cmd_history', title: t('balance.history', locale) },
      ],
    );
  }

  private async showHistory(from: string, userId: string): Promise<void> {
    const history = await this.transactions.getTransactionHistory(userId);
    await this.wa.sendButtonMessage(
      from,
      history,
      [
        { id: 'cmd_pay', title: 'Enviar dinero' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ],
    );
  }

  private async showProfile(from: string, userId: string): Promise<void> {
    const user = await this.users.getUserById(userId);
    if (!user) return;

    const balance = await this.wallets.getBalance(userId);
    const stats = await this.transactions.getTransactionStats(userId);

    const monthlyLimits: Record<string, number> = {
      BASIC: 200_000,
      INTERMEDIATE: 2_000_000,
      FULL: 50_000_000,
    };
    const monthlyLimit = monthlyLimits[user.kycLevel] ?? monthlyLimits.BASIC;
    const monthlyRemaining = Math.max(0, monthlyLimit - stats.monthlySent);
    const limitLabel = user.kycLevel === 'FULL' ? 'Sin límite' : formatCLP(monthlyLimit);

    await this.wa.sendButtonMessage(
      from,
      [
        `*Mi cuenta*`,
        divider(),
        `${user.name || 'Sin nombre'} · Nivel ${user.kycLevel}`,
        `Saldo: *${balance.formatted}*`,
        divider(),
        `Límite mensual: ${limitLabel}`,
        `Usado: ${formatCLP(stats.monthlySent)}`,
        `Disponible: ${user.kycLevel === 'FULL' ? 'Sin límite' : formatCLP(monthlyRemaining)}`,
        divider(),
        `Enviado: ${formatCLP(stats.totalSent)}`,
        `Recibido: ${formatCLP(stats.totalReceived)}`,
        `Operaciones: ${stats.txCount}`,
      ].join('\n'),
      [
        { id: 'cmd_kyc', title: 'Subir nivel' },
        { id: 'cmd_changepin', title: 'Cambiar PIN' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ],
    );
  }

  private async startTopUpFlow(from: string, userId: string): Promise<void> {
    await setSession(from, {
      userId,
      waId: from,
      state: 'TOPUP_SELECT_AMOUNT',
      data: {},
      lastActivity: Date.now(),
    });
    await this.wa.sendButtonMessage(
      from,
      '¿Cuánto quieres recargar?\n(o escribe otro monto entre $1.000 y $500.000)',
      [
        { id: 'topup_10000', title: '$10.000' },
        { id: 'topup_20000', title: '$20.000' },
        { id: 'topup_50000', title: '$50.000' },
      ],
    );
  }

  private async handleTopUpFlow(
    from: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    // Parse preset button click (topup_10000) or free-text custom amount
    const presetMatch = text.match(/^topup_(\d+)$/);
    const amount = presetMatch ? parseInt(presetMatch[1], 10) : parseAmount(text);

    if (isNaN(amount) || amount < 1000 || amount > 500_000) {
      await this.wa.sendTextMessage(
        from,
        'Monto inválido. Escribe un valor entre $1.000 y $500.000 CLP:',
      );
      return;
    }

    try {
      const reference = generateReference();
      const notifyUrl = `${env.APP_BASE_URL}/api/v1/topup/khipu/notify`;
      const returnUrl = `${env.APP_BASE_URL}/topup/success`;

      const payment = await this.khipu.createPayment(
        `Recarga WhatPay ${formatCLP(amount)}`,
        amount,
        notifyUrl,
        returnUrl,
        reference,
      );

      // Store mapping so Khipu callback can credit the wallet
      const redis = getRedis();
      await redis.set(
        `topup:khipu:${payment.paymentId}`,
        JSON.stringify({ userId: session.userId, waId: from, amount }),
        { EX: 3600 },
      );

      await deleteSession(from);

      await this.wa.sendTextMessage(
        from,
        [
          `💳 Recarga de ${formatCLP(amount)}`,
          '',
          'Haz clic para pagar por transferencia bancaria:',
          payment.paymentUrl,
          '',
          '⏰ El link vence en 1 hora.',
          'Una vez pagado, te avisamos por aquí.',
        ].join('\n'),
      );
    } catch (err) {
      log.error('TopUp flow error', { from, error: (err as Error).message });
      await deleteSession(from);
      await this.wa.sendButtonMessage(
        from,
        'No pudimos generar el link de pago. Intenta de nuevo.',
        [
          { id: 'cmd_topup', title: 'Reintentar' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ],
      );
    }
  }

  private async startChangePinFlow(from: string, userId: string): Promise<void> {
    await setSession(from, {
      userId,
      waId: from,
      state: 'CHANGE_PIN_CURRENT',
      data: {},
      lastActivity: Date.now(),
    });
    await this.wa.sendTextMessage(from, 'Escribe tu PIN actual:');
  }

  private async handleChangePinFlow(
    from: string,
    _userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    switch (session.state as State) {
      case 'CHANGE_PIN_CURRENT': {
        const verify = await this.users.verifyUserPin(from, text);
        if (!verify.success) {
          this.audit.log({
            eventType: 'PIN_FAILED',
            actorType: 'USER',
            actorId: _userId,
            targetUserId: _userId,
            metadata: { flow: 'CHANGE_PIN', locked: verify.isLocked ?? false },
          });
          if (verify.isLocked) await deleteSession(from);
          await this.wa.sendTextMessage(from, verify.message);
          return;
        }
        session.state = 'CHANGE_PIN_NEW';
        await setSession(from, session);
        await this.wa.sendTextMessage(from, 'Escribe tu nuevo PIN de 6 dígitos:');
        return;
      }
      case 'CHANGE_PIN_NEW': {
        if (!isSecurePin(text)) {
          await this.wa.sendTextMessage(from, 'PIN inseguro. Elige otro:');
          return;
        }
        session.data.newPinHash = await hashPin(text);
        session.state = 'CHANGE_PIN_CONFIRM';
        await setSession(from, session);
        await this.wa.sendTextMessage(from, 'Confirma tu nuevo PIN:');
        return;
      }
      case 'CHANGE_PIN_CONFIRM': {
        if (!(await verifyPinHash(text, sd(session.data, 'newPinHash')))) {
          session.state = 'CHANGE_PIN_NEW';
          delete session.data.newPinHash;
          await setSession(from, session);
          await this.wa.sendTextMessage(from, 'No coinciden. Escribe el nuevo PIN de nuevo:');
          return;
        }
        // Current PIN was already verified; use UserService to update safely
        await this.users.setNewPin(from, text);
        await deleteSession(from);
        await this.wa.sendButtonMessage(from, 'PIN actualizado correctamente.', [
          { id: 'cmd_balance', title: 'Mi billetera' },
          { id: 'cmd_pay', title: 'Enviar dinero' },
        ]);
        return;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  KYC UPGRADE FLOW
  // ═══════════════════════════════════════════════════════

  private async startKycUpgradeFlow(from: string, userId: string): Promise<void> {
    const user = await this.users.getUserById(userId);
    if (!user) return;

    const limits: Record<string, { tx: string; monthly: string }> = {
      BASIC: { tx: '$50.000', monthly: '$200.000/mes' },
      INTERMEDIATE: { tx: '$500.000', monthly: '$2.000.000/mes' },
      FULL: { tx: '$2.000.000', monthly: 'Sin límite' },
    };

    if (user.kycLevel === 'FULL') {
      await this.wa.sendButtonMessage(
        from,
        'Ya tienes el nivel máximo de verificación (FULL). No hay nada que actualizar.',
        [
          { id: 'cmd_balance', title: 'Mi billetera' },
          { id: 'cmd_profile', title: 'Mi cuenta' },
        ],
      );
      return;
    }

    if (user.kycLevel === 'INTERMEDIATE') {
      await this.wa.sendButtonMessage(
        from,
        [
          'Tu nivel actual es INTERMEDIATE.',
          divider(),
          `Límite por transacción: ${limits.INTERMEDIATE.tx}`,
          `Límite mensual: ${limits.INTERMEDIATE.monthly}`,
          divider(),
          'Para escalar a FULL (sin límite mensual) contáctanos en soporte@whatpay.cl',
        ].join('\n'),
        [
          { id: 'cmd_balance', title: 'Mi billetera' },
          { id: 'cmd_support', title: 'Contactar soporte' },
        ],
      );
      return;
    }

    // BASIC → INTERMEDIATE
    await setSession(from, {
      userId,
      waId: from,
      state: 'KYC_CONFIRM',
      data: {},
      lastActivity: Date.now(),
    });

    await this.wa.sendButtonMessage(
      from,
      [
        'Actualizar a nivel INTERMEDIATE',
        divider(),
        'Límites actuales (BASIC):',
        `  Por transacción: ${limits.BASIC.tx}`,
        `  Mensual: ${limits.BASIC.monthly}`,
        '',
        'Con INTERMEDIATE:',
        `  Por transacción: ${limits.INTERMEDIATE.tx}`,
        `  Mensual: ${limits.INTERMEDIATE.monthly}`,
        divider(),
        'Al confirmar declaras que eres mayor de 18 años y que usas WhatPay para fines lícitos.',
      ].join('\n'),
      [
        { id: 'kyc_confirm', title: 'Confirmar' },
        { id: 'kyc_cancel', title: 'Cancelar' },
      ],
    );
  }

  private async handleKycFlow(
    from: string,
    userId: string,
    text: string,
    _session: ConversationSession,
  ): Promise<void> {
    const normalized = text.trim().toLowerCase();

    if (normalized === 'kyc_cancel' || normalized === 'cancelar') {
      await deleteSession(from);
      await this.wa.sendButtonMessage(from, 'Verificación cancelada.', [
        { id: 'cmd_balance', title: 'Mi billetera' },
        { id: 'cmd_pay', title: 'Enviar dinero' },
      ]);
      return;
    }

    if (normalized === 'kyc_confirm' || normalized === 'confirmar') {
      await this.users.updateKycLevel(userId, 'INTERMEDIATE');
      await deleteSession(from);
      await this.wa.sendButtonMessage(
        from,
        [
          'Cuenta verificada — nivel *INTERMEDIATE*',
          divider(),
          'Nuevos límites activados:',
          '  Por transacción: $500.000',
          '  Mensual: $2.000.000',
        ].join('\n'),
        [
          { id: 'cmd_pay', title: 'Enviar dinero' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ],
      );
      return;
    }

    await this.wa.sendButtonMessage(
      from,
      '¿Quieres verificar tu cuenta?',
      [
        { id: 'kyc_confirm', title: 'Confirmar' },
        { id: 'kyc_cancel', title: 'Cancelar' },
      ],
    );
  }

  // ═══════════════════════════════════════════════════════
  //  STATEFUL ROUTER
  // ═══════════════════════════════════════════════════════

  private async handleStatefulFlow(
    from: string,
    userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    const state = session.state as State;

    if (state.startsWith('PAY_')) {
      return this.handlePayFlow(from, userId, text, session);
    }
    if (state.startsWith('CHARGE_')) {
      return this.handleChargeFlow(from, userId, text, session);
    }
    if (state.startsWith('TOPUP_')) {
      return this.handleTopUpFlow(from, text, session);
    }
    if (state.startsWith('CHANGE_PIN_')) {
      return this.handleChangePinFlow(from, userId, text, session);
    }
    if (state.startsWith('KYC_')) {
      return this.handleKycFlow(from, userId, text, session);
    }
    if (state.startsWith('REFUND_')) {
      return this.handleRefundFlow(from, userId, text, session);
    }

    // Unknown state — reset
    await deleteSession(from);
    await this.sendHelp(from, null);
  }

  // ═══════════════════════════════════════════════════════
  //  REFUND FLOW
  // ═══════════════════════════════════════════════════════

  private async startRefundFlow(from: string, userId: string, rawText: string): Promise<void> {
    const ref = rawText.replace(/^(\/devolver|devolver|devoluci[oó]n|reembolso)\s*/i, '').trim();
    if (!ref) {
      await this.wa.sendButtonMessage(
        from,
        'Escribe la referencia del pago que quieres devolver.\n\nEj: devolver #WP-2026-AABB1122',
        [
          { id: 'cmd_history', title: 'Ver movimientos' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ],
      );
      return;
    }

    const tx = await this.transactions.getTransactionByReference(ref, userId);
    if (!tx) {
      await this.wa.sendButtonMessage(from, 'Transacción no encontrada. Verifica la referencia.', [
        { id: 'cmd_history', title: 'Ver movimientos' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
      return;
    }

    if (tx.direction !== 'Recibido') {
      await this.wa.sendButtonMessage(from, 'Solo puedes devolver pagos que hayas recibido.', [
        { id: 'cmd_history', title: 'Ver movimientos' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
      return;
    }

    if (tx.status === 'REVERSED') {
      await this.wa.sendButtonMessage(from, 'Esta transacción ya fue devuelta.', [
        { id: 'cmd_history', title: 'Ver movimientos' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
      return;
    }

    await setSession(from, {
      userId,
      waId: from,
      state: 'REFUND_CONFIRM',
      data: { reference: ref, amount: tx.amount, otherParty: tx.otherParty },
      lastActivity: Date.now(),
    });

    await this.wa.sendButtonMessage(
      from,
      receipt([
        'Devolver pago:',
        `Monto: ${tx.amount}`,
        `De: ${tx.otherParty}`,
        `Ref: ${tx.reference}`,
      ]),
      [
        { id: 'confirm_refund', title: 'Confirmar devolución' },
        { id: 'cmd_cancel', title: 'Cancelar' },
      ],
    );
  }

  private async handleRefundFlow(
    from: string,
    userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    const state = session.state as State;

    switch (state) {
      case 'REFUND_CONFIRM': {
        if (text === 'confirm_refund' || text.toLowerCase() === 'confirmar devolución') {
          session.state = 'REFUND_ENTER_PIN';
          await setSession(from, session);
          await this.wa.sendTextMessage(from, 'Ingresa tu PIN de 6 dígitos:');
          return;
        }
        await deleteSession(from);
        await this.wa.sendButtonMessage(from, 'Devolución cancelada.', [
          { id: 'cmd_balance', title: 'Mi billetera' },
          { id: 'cmd_history', title: 'Movimientos' },
        ]);
        return;
      }

      case 'REFUND_ENTER_PIN': {
        const pinResult = await this.users.verifyUserPin(from, text);
        if (!pinResult.success) {
          this.audit.log({
            eventType: 'PIN_FAILED',
            actorType: 'USER',
            actorId: userId,
            targetUserId: userId,
            metadata: { flow: 'REFUND', locked: pinResult.isLocked ?? false },
          });
          if (pinResult.isLocked) await deleteSession(from);
          await this.wa.sendTextMessage(from, pinResult.message);
          return;
        }

        const result = await this.transactions.refundTransaction(
          sd(session.data, 'reference'),
          userId,
        );
        await deleteSession(from);

        if (!result.success) {
          await this.wa.sendButtonMessage(
            from,
            result.error || 'Error al procesar la devolución.',
            [
              { id: 'cmd_history', title: 'Movimientos' },
              { id: 'cmd_balance', title: 'Mi billetera' },
            ],
          );
          return;
        }

        await this.wa.sendButtonMessage(
          from,
          [
            'Devolución completada ✅',
            receipt([
              `Monto: ${sd(session.data, 'amount')}`,
              `Devuelto a: ${sd(session.data, 'otherParty')}`,
              `Ref devolución: ${result.refundReference}`,
            ]),
          ].join('\n'),
          [
            { id: 'cmd_balance', title: 'Ver saldo' },
            { id: 'cmd_history', title: 'Historial' },
          ],
        );

        log.info('Refund completed via bot', {
          originalRef: sd(session.data, 'reference'),
          refundRef: result.refundReference,
        });
        return;
      }
    }
  }

  private async showReceipt(from: string, userId: string, rawText: string): Promise<void> {
    const ref = rawText.replace(/^(\/recibo|recibo|comprobante|boleta)\s*/i, '').trim();
    if (!ref) {
      await this.wa.sendButtonMessage(
        from,
        'Escribe la referencia del pago.\n\nEj: recibo #WP-2026-AABB1122',
        [
          { id: 'cmd_history', title: 'Ver movimientos' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ],
      );
      return;
    }

    const tx = await this.transactions.getTransactionByReference(ref, userId);
    if (!tx) {
      await this.wa.sendButtonMessage(from, 'Transacción no encontrada. Verifica la referencia.', [
        { id: 'cmd_history', title: 'Ver movimientos' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
      return;
    }

    await this.wa.sendButtonMessage(
      from,
      [
        '*Comprobante*',
        receipt([
          `Ref: ${tx.reference}`,
          `Tipo: ${tx.direction}`,
          `Monto: ${tx.amount}`,
          `Comisión: ${tx.fee}`,
          `${tx.direction === 'Enviado' ? 'Para' : 'De'}: ${tx.otherParty}`,
          `Fecha: ${tx.date}`,
          `Estado: ${tx.status}`,
        ]),
      ].join('\n'),
      [
        { id: 'cmd_history', title: 'Movimientos' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ],
    );
  }

  // ═══════════════════════════════════════════════════════
  //  PROMOTIONS
  // ═══════════════════════════════════════════════════════

  private async showPromo(from: string, _userId: string, rawText: string): Promise<void> {
    const code = rawText
      .replace(/^(\/promo|promo)\s*/i, '')
      .trim()
      .toUpperCase();

    if (!code) {
      // No code given — list active promos
      try {
        const active = await promoSvc.listActive();
        if (active.length === 0) {
          await this.wa.sendButtonMessage(
            from,
            'No hay promociones activas en este momento.\n\nEscribe */promo CODIGO* para canjear un código.',
            [{ id: 'cmd_pay', title: 'Enviar dinero' }],
          );
          return;
        }
        const lines = ['🎁 *Promociones activas*', ''];
        for (const p of active.slice(0, 4)) {
          const val = p.type === 'percentage' || p.type === 'cashback'
            ? `${p.value}%` : `$${p.value.toLocaleString('es-CL')} CLP`;
          lines.push(`• *${p.name}* — ${val}${p.code ? ` (código: ${p.code})` : ''}`);
        }
        lines.push('', 'Escribe */promo CODIGO* para aplicar.');
        await this.wa.sendButtonMessage(from, lines.join('\n'), [
          { id: 'cmd_pay', title: 'Enviar dinero' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ]);
      } catch (err) {
        log.warn('showPromo list error', { error: (err as Error).message });
        await this.wa.sendButtonMessage(from, 'No pude cargar las promociones. Intenta de nuevo.', [
          { id: 'cmd_balance', title: 'Mi billetera' },
        ]);
      }
      return;
    }

    // Code given — validate it
    try {
      const promo = await promoSvc.findByCode(code);
      if (!promo || !promo.active) {
        await this.wa.sendButtonMessage(from, `El código *${code}* no es válido o ya expiró.`, [
          { id: 'cmd_pay', title: 'Enviar dinero' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ]);
        return;
      }

      const now = new Date().toISOString();
      if (now > promo.endDate) {
        await this.wa.sendButtonMessage(from, `El código *${code}* ya expiró.`, [
          { id: 'cmd_pay', title: 'Enviar dinero' },
        ]);
        return;
      }

      const typeLabel: Record<string, string> = {
        percentage: 'Descuento porcentual',
        fixed: 'Descuento fijo',
        cashback: 'Cashback',
        free_fee: 'Sin comisión',
      };
      const val = promo.type === 'percentage' || promo.type === 'cashback'
        ? `${promo.value}%` : `$${promo.value.toLocaleString('es-CL')} CLP`;

      const lines = [
        `✅ *Código ${code} válido*`,
        '',
        `Beneficio: *${typeLabel[promo.type] ?? promo.type}* — *${val}*`,
        promo.description ? promo.description : '',
        promo.minAmount > 0 ? `Monto mínimo: $${promo.minAmount.toLocaleString('es-CL')}` : '',
        '',
        'El descuento se aplicará automáticamente en tu próximo pago.',
      ].filter(Boolean);

      await this.wa.sendButtonMessage(from, lines.join('\n'), [
        { id: 'cmd_pay', title: 'Enviar dinero ahora' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
    } catch (err) {
      log.warn('showPromo validate error', { code, error: (err as Error).message });
      await this.wa.sendButtonMessage(from, 'No pude validar el código en este momento.', [
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  LOYALTY POINTS
  // ═══════════════════════════════════════════════════════

  private async showPoints(from: string, userId: string): Promise<void> {
    const TIER_EMOJI: Record<string, string> = {
      BRONCE: '🥉',
      PLATA: '🥈',
      ORO: '🥇',
      PLATINO: '💎',
    };

    try {
      const [account, tierInfo] = await Promise.all([
        loyaltySvc.getAccount(userId),
        loyaltySvc.getTierInfo(userId),
      ]);

      const emoji = TIER_EMOJI[account.tier] ?? '🎖️';
      const lines = [
        `${emoji} *Mis puntos WhatPay*`,
        '',
        `Tier: *${account.tier}*`,
        `Puntos disponibles: *${account.points.toLocaleString('es-CL')}*`,
        `Puntos de vida: *${account.lifetimePoints.toLocaleString('es-CL')}*`,
        `Multiplicador: *×${tierInfo.multiplier}*`,
      ];

      if (tierInfo.nextTier) {
        lines.push('');
        lines.push(`Faltan *${tierInfo.pointsToNext.toLocaleString('es-CL')}* pts para ${TIER_EMOJI[tierInfo.nextTier]} ${tierInfo.nextTier}`);
      } else {
        lines.push('');
        lines.push('🏆 ¡Estás en el nivel máximo!');
      }

      lines.push('');
      lines.push('Ganas *1 punto por cada $100 CLP* pagados.');

      await this.wa.sendButtonMessage(from, lines.join('\n'), [
        { id: 'cmd_pay', title: 'Enviar dinero' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
    } catch (err) {
      log.warn('showPoints error', { userId, error: (err as Error).message });
      await this.wa.sendButtonMessage(
        from,
        'No pude cargar tus puntos en este momento. Intenta de nuevo.',
        [{ id: 'cmd_balance', title: 'Mi billetera' }],
      );
    }
  }

  // ═══════════════════════════════════════════════════════
  //  INVITE / REFERRAL
  // ═══════════════════════════════════════════════════════

  private async showInvite(from: string, userId: string): Promise<void> {
    try {
      const codeObj = await referralSvc.generateCode(userId);
      const stats = await referralSvc.getStats(userId);
      const shareLink = `${env.APP_BASE_URL}/invita/${codeObj.code}`;

      const lines = [
        '🎁 *Tu código de referido*',
        '',
        `Código: *${codeObj.code}*`,
        `Link: ${shareLink}`,
        '',
        'Cuando un amigo se registre con tu código:',
        `• Tú ganas *$${codeObj.rewardPerReferral.toLocaleString('es-CL')} CLP*`,
        `• Tu amigo recibe *$${codeObj.rewardForReferred.toLocaleString('es-CL')} CLP* de bienvenida`,
        '',
        `📊 Tus referidos: *${stats.completedReferrals}* completados`,
        `💰 Total ganado: *$${stats.totalEarned.toLocaleString('es-CL')} CLP*`,
      ];

      await this.wa.sendButtonMessage(from, lines.join('\n'), [
        { id: 'cmd_pay', title: 'Enviar dinero' },
        { id: 'cmd_balance', title: 'Mi billetera' },
      ]);
    } catch (err) {
      log.warn('showInvite error', { userId, error: (err as Error).message });
      await this.wa.sendButtonMessage(
        from,
        'No pude cargar tu código en este momento. Intenta de nuevo.',
        [{ id: 'cmd_balance', title: 'Mi billetera' }],
      );
    }
  }

  private async sendHelp(from: string, name: string | null, userId?: string): Promise<void> {
    const locale = await this.getLocale(userId);
    const greet = greetingI18n(name, locale);

    // Context-aware: show balance summary for returning users
    let context = '';
    if (userId) {
      try {
        const balance = await this.wallets.getBalance(userId);
        context = `\n${t('balance.label', locale)}: *${balance.formatted}*`;
      } catch { /* fail-open */ }
    }

    await this.wa.sendButtonMessage(
      from,
      `${greet} 👋\n${t('menu.whatDoYouNeed', locale)}${context}`,
      [
        { id: 'cmd_pay', title: t('menu.sendMoney', locale) },
        { id: 'cmd_charge', title: t('menu.charge', locale) },
        { id: 'cmd_balance', title: t('menu.myWallet', locale) },
      ],
    );
  }

  // ═══════════════════════════════════════════════════════
  //  NOTIFICATION PREFERENCES
  // ═══════════════════════════════════════════════════════

  private async toggleMute(from: string, userId: string): Promise<void> {
    const prefs = await notificationPrefs.toggleEnabled(userId);
    const statusText = prefs.enabled
      ? 'Notificaciones *activadas*.\nRecibirás avisos de pagos recibidos.'
      : 'Notificaciones *silenciadas*.\nEscribe "notificaciones" para reactivar.';

    await this.wa.sendButtonMessage(from, statusText, [
      { id: 'cmd_balance', title: 'Mi billetera' },
      { id: 'cmd_pay', title: 'Enviar dinero' },
    ]);
  }

  private async handleQuietHours(from: string, userId: string, rawText: string): Promise<void> {
    const args = rawText.replace(/^(\/horario|horario\s*silencioso|horario)\s*/i, '').trim();

    if (args.toLowerCase() === 'off') {
      await notificationPrefs.disableQuietHours(userId);
      await this.wa.sendButtonMessage(
        from,
        'Horario silencioso *desactivado*.\nRecibirás notificaciones a cualquier hora.',
        [{ id: 'cmd_balance', title: 'Mi billetera' }],
      );
      return;
    }

    const match = args.match(/^(\d{1,2})\s*[-a]\s*(\d{1,2})$/);
    if (!match) {
      const prefs = await notificationPrefs.get(userId);
      const status = prefs.quietHoursEnabled
        ? `Activo: ${prefs.quietStart}:00 - ${prefs.quietEnd}:00`
        : 'Desactivado';

      await this.wa.sendButtonMessage(
        from,
        [
          `*Horario silencioso:* ${status}`,
          '',
          'Escribe "horario 23-7" para activar',
          'Escribe "horario off" para desactivar',
        ].join('\n'),
        [{ id: 'cmd_balance', title: 'Mi billetera' }],
      );
      return;
    }

    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);

    try {
      await notificationPrefs.setQuietHours(userId, start, end);
      await this.wa.sendButtonMessage(
        from,
        `Horario silencioso *activado*: ${start}:00 - ${end}:00\nNo recibirás notificaciones en ese horario.`,
        [{ id: 'cmd_balance', title: 'Mi billetera' }],
      );
    } catch {
      await this.wa.sendButtonMessage(
        from,
        'Horas inválidas. Usa valores entre 0 y 23.\nEj: horario 23-7',
        [{ id: 'cmd_balance', title: 'Mi billetera' }],
      );
    }
  }

  // ═══════════════════════════════════════════════════════
  //  QR PAYMENTS
  // ═══════════════════════════════════════════════════════

  private async showQr(from: string, userId: string): Promise<void> {
    try {
      const qrs = await qrPayment.getUserQrs(userId);
      const active = qrs.filter(q => q.status === 'active');

      if (active.length === 0) {
        // Generate a new static QR for this user
        const qr = await qrPayment.generateQr({
          createdBy: userId,
          type: 'static',
        });
        const scanUrl = qrPayment.getQrPayload(qr.reference, env.APP_BASE_URL);
        await this.wa.sendButtonMessage(
          from,
          `*Tu código QR para recibir pagos*\n\nCódigo: *${qr.reference}*\nURL: ${scanUrl}\n\nComparte este código para que te paguen. Funciona ilimitadamente.`,
          [
            { id: 'cmd_balance', title: 'Mi billetera' },
            { id: 'cmd_qr', title: 'Nuevo QR' },
          ],
        );
      } else {
        const qr = active[0];
        const scanUrl = qrPayment.getQrPayload(qr.reference, env.APP_BASE_URL);
        const amountStr = qr.amount ? ` por ${formatCLP(qr.amount)}` : ' (monto libre)';
        await this.wa.sendButtonMessage(
          from,
          `*Tu QR activo${amountStr}*\n\nCódigo: *${qr.reference}*\nTipo: ${qr.type === 'static' ? 'Reutilizable' : 'Un solo uso'}\nURL: ${scanUrl}\n\nTienes ${active.length} QR activo${active.length > 1 ? 's' : ''}.`,
          [
            { id: 'cmd_balance', title: 'Mi billetera' },
            { id: 'cmd_pay', title: 'Enviar dinero' },
          ],
        );
      }
    } catch {
      await this.wa.sendTextMessage(from, 'No pude generar tu QR. Intenta de nuevo.');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SPLIT PAYMENTS
  // ═══════════════════════════════════════════════════════

  private async showSplit(from: string, userId: string): Promise<void> {
    try {
      const splits = await splitPayment.getUserSplits(userId);
      const active = splits.filter(s => s.status === 'pending' || s.status === 'partial');

      if (active.length === 0) {
        await this.wa.sendButtonMessage(
          from,
          '*Dividir cuenta*\n\nNo tienes cuentas pendientes por dividir.\n\nPara crear una, usa la app o API:\nPOST /api/v1/splits',
          [
            { id: 'cmd_pay', title: 'Enviar dinero' },
            { id: 'cmd_balance', title: 'Mi billetera' },
          ],
        );
      } else {
        const latest = active[0];
        const summary = splitPayment.formatSplitSummary(latest);
        await this.wa.sendButtonMessage(
          from,
          `*Tus cuentas divididas*\n\nTienes ${active.length} pendiente${active.length > 1 ? 's' : ''}:\n\n${summary}`,
          [
            { id: 'cmd_balance', title: 'Mi billetera' },
            { id: 'cmd_history', title: 'Historial' },
          ],
        );
      }
    } catch {
      await this.wa.sendTextMessage(from, 'No pude cargar tus cuentas divididas.');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SCHEDULED TRANSFERS
  // ═══════════════════════════════════════════════════════

  private async showScheduled(from: string, userId: string): Promise<void> {
    try {
      const transfers = await scheduledTransfer.getUserTransfers(userId);
      const active = transfers.filter(t => t.status === 'scheduled');

      if (active.length === 0) {
        await this.wa.sendButtonMessage(
          from,
          '*Pagos programados*\n\nNo tienes pagos programados.\n\nPara crear uno, usa la app o API:\nPOST /api/v1/scheduled-transfers',
          [
            { id: 'cmd_pay', title: 'Enviar dinero' },
            { id: 'cmd_balance', title: 'Mi billetera' },
          ],
        );
      } else {
        const lines = active.map(t =>
          `• ${t.receiverName}: ${formatCLP(t.amount)} — ${t.frequency === 'once' ? t.scheduledDate : `cada ${t.frequency === 'weekly' ? 'semana' : t.frequency === 'biweekly' ? '2 semanas' : 'mes'}`}`,
        ).join('\n');

        await this.wa.sendButtonMessage(
          from,
          `*Pagos programados (${active.length})*\n\n${lines}`,
          [
            { id: 'cmd_balance', title: 'Mi billetera' },
            { id: 'cmd_history', title: 'Historial' },
          ],
        );
      }
    } catch {
      await this.wa.sendTextMessage(from, 'No pude cargar tus pagos programados.');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PAYMENT REQUESTS
  // ═══════════════════════════════════════════════════════

  private async showRequest(from: string, userId: string): Promise<void> {
    try {
      const sent = await paymentRequest.getSentRequests(userId);
      const pending = sent.filter(r => r.status === 'pending');
      const received = await paymentRequest.getReceivedRequests(from);
      const pendingReceived = received.filter(r => r.status === 'pending');

      const lines: string[] = ['*Solicitudes de pago*\n'];

      if (pendingReceived.length > 0) {
        lines.push(`*Te piden (${pendingReceived.length}):*`);
        for (const r of pendingReceived.slice(0, 5)) {
          lines.push(`• ${r.requesterName}: ${formatCLP(r.amount)} — ${r.description}`);
        }
        lines.push('');
      }

      if (pending.length > 0) {
        lines.push(`*Pediste (${pending.length} pendientes):*`);
        for (const r of pending.slice(0, 5)) {
          lines.push(`• A ${r.targetName || r.targetPhone}: ${formatCLP(r.amount)} — ${r.description}`);
        }
      }

      if (pending.length === 0 && pendingReceived.length === 0) {
        lines.push('No tienes solicitudes pendientes.');
      }

      await this.wa.sendButtonMessage(
        from,
        lines.join('\n'),
        [
          { id: 'cmd_pay', title: 'Enviar dinero' },
          { id: 'cmd_charge', title: 'Cobrar' },
          { id: 'cmd_balance', title: 'Mi billetera' },
        ],
      );
    } catch {
      await this.wa.sendTextMessage(from, 'No pude cargar tus solicitudes.');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  ACCOUNT DELETION
  // ═══════════════════════════════════════════════════════

  private async handleDeleteAccount(from: string, userId: string): Promise<void> {
    const locale = await this.getLocale(userId);
    const { accountDeletion } = await import('./account-deletion.service');

    // Check for existing request
    const existing = await accountDeletion.getPendingRequest(userId);

    if (existing) {
      await this.wa.sendButtonMessage(
        from,
        [
          locale === 'en'
            ? '*Account deletion already requested*'
            : '*Ya solicitaste eliminar tu cuenta*',
          '',
          locale === 'en'
            ? `Scheduled for: ${new Date(existing.scheduledAt).toLocaleDateString('es-CL')}`
            : `Programada para: ${new Date(existing.scheduledAt).toLocaleDateString('es-CL')}`,
          '',
          locale === 'en'
            ? 'You can cancel before that date.'
            : 'Puedes cancelar antes de esa fecha.',
        ].join('\n'),
        [
          { id: 'cancel_deletion', title: locale === 'en' ? 'Cancel deletion' : 'Cancelar' },
          { id: 'cmd_balance', title: t('menu.myWallet', locale) },
        ],
      );
      return;
    }

    await this.wa.sendButtonMessage(
      from,
      [
        locale === 'en'
          ? '*Delete your account?*'
          : '*Eliminar tu cuenta?*',
        '',
        locale === 'en'
          ? 'This will permanently delete your account and all data after a 7-day grace period.'
          : 'Esto eliminará permanentemente tu cuenta y datos después de 7 días de gracia.',
        '',
        locale === 'en'
          ? 'Your balance must be $0 before deletion.'
          : 'Tu saldo debe ser $0 antes de la eliminación.',
        '',
        locale === 'en'
          ? 'You can cancel within 7 days.'
          : 'Puedes cancelar dentro de 7 días.',
      ].join('\n'),
      [
        { id: 'confirm_delete', title: locale === 'en' ? 'Yes, delete' : 'Sí, eliminar' },
        { id: 'cmd_balance', title: t('menu.myWallet', locale) },
      ],
    );
  }
}
