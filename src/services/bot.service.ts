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

const log = createLogger('bot-service');

// Type-safe accessors for session.data (Record<string, unknown>)
const sd = (data: Record<string, unknown>, key: string): string => (data[key] as string) ?? '';
const sdn = (data: Record<string, unknown>, key: string): number => (data[key] as number) ?? 0;

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

  async handleMessage(from: string, text: string, buttonId?: string): Promise<void> {
    try {
      // Get or create session
      const session = await getSession(from);
      const user = await this.users.getUserByWaId(from);

      // ── Not registered → Onboarding
      if (!user && !session) {
        await this.startRegistration(from);
        return;
      }

      // ── In registration flow
      if (session && session.state.startsWith('REGISTER')) {
        await this.handleRegistration(from, text, session);
        return;
      }

      // ── Registered user: handle commands or state
      if (user) {
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
        await this.sendHelp(from, user.name);
      }
    } catch (err) {
      log.error('Bot error', { from, error: (err as Error).message });
      await this.wa.sendTextMessage(from, 'Tuvimos un problema. Intenta de nuevo en un momento.');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  REGISTRATION
  // ═══════════════════════════════════════════════════════

  private async startRegistration(from: string): Promise<void> {
    await this.wa.sendButtonMessage(
      from,
      [
        'Hola! Soy WhatPay.',
        'Envía y recibe pagos directo desde WhatsApp.',
        '',
        'Para empezar necesito verificar tu identidad.',
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
        await this.wa.sendButtonMessage(
          from,
          [
            'Cuenta creada! Bienvenido a WhatPay.',
            '',
            'Nivel: Básico (hasta $200.000/mes)',
            'Saldo: $0 CLP',
            '',
            '¿Qué quieres hacer?',
          ].join('\n'),
          [
            { id: 'cmd_pay', title: 'Enviar pago' },
            { id: 'cmd_charge', title: 'Cobrar' },
            { id: 'cmd_topup', title: 'Recargar saldo' },
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
    const normalized = text.trim().toLowerCase();

    // Button IDs
    if (buttonId?.startsWith('cmd_')) return buttonId.replace('cmd_', '');

    // Text commands
    if (normalized.startsWith('/pagar') || normalized === 'pagar') return 'pay';
    if (normalized.startsWith('/cobrar')) return 'charge';
    if (normalized.startsWith('/saldo') || normalized === 'saldo') return 'balance';
    if (normalized.startsWith('/recargar')) return 'topup';
    if (normalized.startsWith('/historial')) return 'history';
    if (normalized.startsWith('/ayuda') || normalized === 'hola' || normalized === 'menu')
      return 'help';
    if (normalized.startsWith('/soporte')) return 'support';
    if (normalized.startsWith('/perfil')) return 'profile';
    if (normalized.startsWith('/cambiarpin')) return 'changepin';
    if (normalized.startsWith('/kyc') || normalized === 'verificar') return 'kyc';
    if (normalized.startsWith('/cancelar') || normalized === 'cancelar') return 'cancel';
    if (normalized.startsWith('/recibo')) return 'receipt';
    if (normalized.startsWith('/devolver')) return 'refund';
    if (normalized.startsWith('/silenciar')) return 'mute';
    if (normalized.startsWith('/horario')) return 'quiethours';

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
        const user = await this.users.getUserByWaId(from);
        return this.sendHelp(from, user?.name ?? null);
      }
      case 'support':
        return this.wa.sendTextMessage(
          from,
          'Soporte WhatPay: escríbenos a soporte@whatpay.cl o llama al 600 XXX XXXX (Lun-Vie 9-18h).',
        );
      case 'profile':
        return this.showProfile(from, userId);
      case 'changepin':
        return this.startChangePinFlow(from, userId);
      case 'kyc':
        return this.startKycUpgradeFlow(from, userId);
      case 'cancel': {
        await deleteSession(from);
        const user = await this.users.getUserByWaId(from);
        await this.wa.sendTextMessage(from, 'Operación cancelada.');
        return this.sendHelp(from, user?.name ?? null);
      }
      case 'receipt':
        return this.showReceipt(from, userId, rawText);
      case 'refund':
        return this.startRefundFlow(from, userId, rawText);
      case 'mute':
        return this.toggleMute(from, userId);
      case 'quiethours':
        return this.handleQuietHours(from, userId, rawText);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PAY FLOW (Stateful)
  // ═══════════════════════════════════════════════════════

  private async startPayFlow(from: string, userId: string, rawText?: string): Promise<void> {
    // Quick-pay: /pagar 56912345678 5000
    if (rawText) {
      const parts = rawText.replace(/\/pagar/i, '').trim().split(/\s+/);
      const quickPhone = parts[0]?.replace(/[\s\-+]/g, '');
      const quickAmount = parseInt(parts[1], 10);

      if (quickPhone && /^\d{8,12}$/.test(quickPhone) && !isNaN(quickAmount) && quickAmount >= 100) {
        const normalizedPhone = quickPhone.startsWith('56') ? quickPhone : `56${quickPhone}`;
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
              { id: 'cmd_help', title: 'Cancelar' },
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
        const phone = rawPhone.replace(/[\s\-+]/g, '');
        const normalizedPhone = phone.startsWith('56') ? phone : `56${phone}`;

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
          await this.wa.sendTextMessage(
            from,
            'No puedes pagarte a ti mismo. Usa /pagar para intentar con otro número.',
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
        const amount = amtMatch
          ? parseInt(amtMatch[1], 10)
          : parseInt(text.replace(/[$.]/g, ''), 10);
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
            { id: 'cmd_help', title: 'Cancelar' },
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
          session.state = 'PAY_ENTER_PIN';
          await setSession(from, session);
          await this.wa.sendTextMessage(from, 'Ingresa tu PIN de 6 dígitos:');
          return;
        }
        await deleteSession(from);
        await this.wa.sendTextMessage(from, 'Pago cancelado.');
        return;
      }

      case 'PAY_ENTER_PIN': {
        // Verify PIN
        const pinResult = await this.users.verifyUserPin(from, text);
        if (!pinResult.success) {
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

        if (!payment.success) {
          await this.wa.sendTextMessage(from, payment.error || 'Error al procesar el pago.');
          return;
        }

        const now = formatDateCL(new Date());

        // Notify sender with smart action buttons
        await this.wa.sendButtonMessage(
          from,
          [
            'Pago enviado!',
            receipt([
              `${formatCLP(sdn(session.data, 'amount'))} -> ${sd(session.data, 'receiverName')}`,
              `Ref: ${payment.reference}`,
              `Fecha: ${now}`,
              `Saldo: ${payment.senderBalance}`,
            ]),
          ].join('\n'),
          [
            { id: 'cmd_pay', title: 'Otro pago' },
            { id: 'cmd_balance', title: 'Ver saldo' },
          ],
        );

        // Notify receiver with reference for receipts
        const sender = await this.users.getUserByWaId(from);
        await this.wa.sendButtonMessage(
          sd(session.data, 'receiverPhone'),
          [
            'Tienes un pago!',
            receipt([
              `${sender?.name || formatPhone(from)} te envió ${formatCLP(sdn(session.data, 'amount'))}`,
              `Ref: ${payment.reference}`,
              `Fecha: ${now}`,
            ]),
          ].join('\n'),
          [
            { id: 'cmd_balance', title: 'Ver saldo' },
            { id: 'cmd_pay', title: 'Devolver pago' },
          ],
        );

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
    // Quick charge: /cobrar 3500 Café
    const parts = rawText
      .replace(/\/cobrar/i, '')
      .trim()
      .split(/\s+/);
    const quickAmount = parseInt(parts[0], 10);

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
        const amount = amtMatch
          ? parseInt(amtMatch[1], 10)
          : parseInt(text.replace(/[$.]/g, ''), 10);
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
    const phone = text.replace(/[\s\-+]/g, '');
    const normalizedPhone = phone.startsWith('56') ? phone : `56${phone}`;

    if (!/^\d{10,12}$/.test(normalizedPhone)) {
      await this.wa.sendTextMessage(
        from,
        'Número inválido. Escribe un número chileno (ej: +56912345678):',
      );
      return;
    }

    const merchant = await this.users.getUserByWaId(from);
    await this.wa.sendTextMessage(
      normalizedPhone,
      [
        `${merchant?.name || 'Alguien'} te envió un cobro:`,
        receipt([
          `Monto: ${formatCLP(sdn(session.data, 'linkAmount'))}`,
          `Concepto: ${sd(session.data, 'linkDescription')}`,
          `Pagar: ${sd(session.data, 'linkUrl')}`,
        ]),
      ].join('\n'),
    );

    await deleteSession(from);
    await this.wa.sendTextMessage(from, `Cobro enviado a ${formatPhone(normalizedPhone)}.`);
  }

  // ═══════════════════════════════════════════════════════
  //  QUICK COMMANDS
  // ═══════════════════════════════════════════════════════

  private async showBalance(from: string, userId: string): Promise<void> {
    const balance = await this.wallets.getBalance(userId);
    await this.wa.sendButtonMessage(from, `Tu saldo: ${balance.formatted}`, [
      { id: 'cmd_topup', title: 'Recargar' },
      { id: 'cmd_history', title: 'Historial' },
    ]);
  }

  private async showHistory(from: string, userId: string): Promise<void> {
    const history = await this.transactions.getTransactionHistory(userId);
    await this.wa.sendTextMessage(from, history);
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

    await this.wa.sendTextMessage(
      from,
      [
        'Tu perfil WhatPay:',
        divider(),
        `Nombre: ${user.name || 'Sin nombre'}`,
        `Nivel: ${user.kycLevel}`,
        `Límite mensual: ${limitLabel}`,
        `Usado este mes: ${formatCLP(stats.monthlySent)}`,
        `Disponible mes: ${user.kycLevel === 'FULL' ? 'Sin límite' : formatCLP(monthlyRemaining)}`,
        `Saldo: ${balance.formatted}`,
        `Enviado total: ${formatCLP(stats.totalSent)}`,
        `Recibido total: ${formatCLP(stats.totalReceived)}`,
        `Transacciones: ${stats.txCount}`,
        `Biometría: ${user.biometricEnabled ? 'Activada' : 'No activada'}`,
        divider(),
      ].join('\n'),
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
    const amount = presetMatch
      ? parseInt(presetMatch[1], 10)
      : parseInt(text.replace(/[$.]/g, ''), 10);

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
      await deleteSession(from);
      await this.wa.sendTextMessage(from, 'Error al generar el link de pago. Intenta de nuevo.');
      throw err;
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
        await this.wa.sendTextMessage(from, 'PIN actualizado correctamente.');
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
      await this.wa.sendTextMessage(
        from,
        'Ya tienes el nivel máximo de verificación (FULL). No hay nada que actualizar.',
      );
      return;
    }

    if (user.kycLevel === 'INTERMEDIATE') {
      await this.wa.sendTextMessage(
        from,
        [
          'Tu nivel actual es INTERMEDIATE.',
          divider(),
          `Límite por transacción: ${limits.INTERMEDIATE.tx}`,
          `Límite mensual: ${limits.INTERMEDIATE.monthly}`,
          divider(),
          'Para escalar a FULL (sin límite mensual) contáctanos en soporte@whatpay.cl',
        ].join('\n'),
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
      await this.wa.sendTextMessage(from, 'Verificación cancelada.');
      return;
    }

    if (normalized === 'kyc_confirm' || normalized === 'confirmar') {
      await this.users.updateKycLevel(userId, 'INTERMEDIATE');
      await deleteSession(from);
      await this.wa.sendTextMessage(
        from,
        [
          '✅ Cuenta verificada — nivel INTERMEDIATE',
          divider(),
          'Nuevos límites activados:',
          '  Por transacción: $500.000',
          '  Mensual: $2.000.000',
          divider(),
          'Puedes seguir usando /pagar, /cobrar y acceder al dashboard de comercio.',
        ].join('\n'),
      );
      return;
    }

    await this.wa.sendTextMessage(
      from,
      'Responde "Confirmar" para verificar o "Cancelar" para volver.',
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
    const ref = rawText.replace(/\/devolver/i, '').trim();
    if (!ref) {
      await this.wa.sendTextMessage(
        from,
        'Uso: /devolver #WP-2026-AABB1122\n\nEncuentra tu referencia en /historial.',
      );
      return;
    }

    const tx = await this.transactions.getTransactionByReference(ref, userId);
    if (!tx) {
      await this.wa.sendTextMessage(from, 'Transacción no encontrada. Verifica la referencia.');
      return;
    }

    if (tx.direction !== 'Recibido') {
      await this.wa.sendTextMessage(from, 'Solo puedes devolver pagos que hayas recibido.');
      return;
    }

    if (tx.status === 'REVERSED') {
      await this.wa.sendTextMessage(from, 'Esta transacción ya fue devuelta.');
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
        await this.wa.sendTextMessage(from, 'Devolución cancelada.');
        return;
      }

      case 'REFUND_ENTER_PIN': {
        const pinResult = await this.users.verifyUserPin(from, text);
        if (!pinResult.success) {
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
          await this.wa.sendTextMessage(from, result.error || 'Error al procesar la devolución.');
          return;
        }

        await this.wa.sendButtonMessage(
          from,
          [
            'Devolución completada!',
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
    const ref = rawText.replace(/\/recibo/i, '').trim();
    if (!ref) {
      await this.wa.sendTextMessage(
        from,
        'Uso: /recibo #WP-2026-AABB1122\n\nEncuentra tu referencia en /historial.',
      );
      return;
    }

    const tx = await this.transactions.getTransactionByReference(ref, userId);
    if (!tx) {
      await this.wa.sendTextMessage(from, 'Transacción no encontrada. Verifica la referencia.');
      return;
    }

    await this.wa.sendTextMessage(
      from,
      [
        'Comprobante de transacción:',
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
    );
  }

  private async sendHelp(from: string, name: string | null): Promise<void> {
    await this.wa.sendListMessage(
      from,
      `${name ? `Hola ${name}!` : 'Hola!'} Soy WhatPay.\nEnvía y recibe dinero desde WhatsApp.`,
      'Ver opciones',
      [
        {
          title: 'Pagos',
          rows: [
            { id: 'cmd_pay', title: 'Enviar pago', description: 'Transfiere dinero a otro usuario' },
            { id: 'cmd_charge', title: 'Cobrar', description: 'Crea un enlace de cobro' },
            { id: 'cmd_balance', title: 'Ver saldo', description: 'Consulta tu saldo actual' },
            { id: 'cmd_topup', title: 'Recargar saldo', description: 'Agrega fondos vía Khipu' },
          ],
        },
        {
          title: 'Cuenta',
          rows: [
            { id: 'cmd_history', title: 'Historial', description: 'Últimas transacciones' },
            { id: 'cmd_profile', title: 'Mi perfil', description: 'Tu cuenta y límites' },
            { id: 'cmd_kyc', title: 'Subir nivel', description: 'Aumenta tus límites de pago' },
            { id: 'cmd_changepin', title: 'Cambiar PIN', description: 'Actualiza tu PIN de seguridad' },
            { id: 'cmd_receipt', title: 'Comprobante', description: 'Busca un recibo por referencia' },
            { id: 'cmd_refund', title: 'Devolver pago', description: 'Devuelve un pago recibido' },
          ],
        },
        {
          title: 'Otros',
          rows: [
            { id: 'cmd_mute', title: 'Silenciar', description: 'Activa/desactiva notificaciones' },
            { id: 'cmd_cancel', title: 'Cancelar', description: 'Cancela la operación actual' },
            { id: 'cmd_support', title: 'Soporte', description: 'Contacta ayuda humana' },
          ],
        },
      ],
    );
  }

  // ═══════════════════════════════════════════════════════
  //  NOTIFICATION PREFERENCES
  // ═══════════════════════════════════════════════════════

  private async toggleMute(from: string, userId: string): Promise<void> {
    const prefs = await notificationPrefs.toggleEnabled(userId);
    const statusText = prefs.enabled
      ? 'Notificaciones *activadas*. Recibirás avisos de pagos recibidos.'
      : 'Notificaciones *silenciadas*. No recibirás avisos de pagos (puedes reactivar con /silenciar).';

    await this.wa.sendTextMessage(from, statusText);
  }

  private async handleQuietHours(from: string, userId: string, rawText: string): Promise<void> {
    const args = rawText.replace(/\/horario/i, '').trim();

    // /horario off → disable quiet hours
    if (args.toLowerCase() === 'off') {
      await notificationPrefs.disableQuietHours(userId);
      await this.wa.sendTextMessage(from, 'Horario silencioso *desactivado*. Recibirás notificaciones a cualquier hora.');
      return;
    }

    // /horario 23-7 → set quiet hours
    const match = args.match(/^(\d{1,2})\s*[-a]\s*(\d{1,2})$/);
    if (!match) {
      const prefs = await notificationPrefs.get(userId);
      const status = prefs.quietHoursEnabled
        ? `Activo: ${prefs.quietStart}:00 - ${prefs.quietEnd}:00`
        : 'Desactivado';

      await this.wa.sendTextMessage(
        from,
        [
          `*Horario silencioso:* ${status}`,
          '',
          'Uso: /horario INICIO-FIN',
          'Ejemplo: /horario 23-7 (silencio de 23:00 a 07:00)',
          '/horario off (desactivar)',
        ].join('\n'),
      );
      return;
    }

    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);

    try {
      await notificationPrefs.setQuietHours(userId, start, end);
      await this.wa.sendTextMessage(
        from,
        `Horario silencioso *activado*: ${start}:00 - ${end}:00\nNo recibirás notificaciones en ese horario.`,
      );
    } catch {
      await this.wa.sendTextMessage(from, 'Horas inválidas. Usa valores entre 0 y 23. Ejemplo: /horario 23-7');
    }
  }
}
