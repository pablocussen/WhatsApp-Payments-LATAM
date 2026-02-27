import { WhatsAppService } from './whatsapp.service';
import { UserService } from './user.service';
import { WalletService } from './wallet.service';
import { TransactionService } from './transaction.service';
import { PaymentLinkService } from './payment-link.service';
import { getSession, setSession, deleteSession, ConversationSession } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP, formatPhone, divider, receipt } from '../utils/format';
import { validateRut, formatRut, hashPin, verifyPinHash } from '../utils/crypto';
import { isSecurePin } from '../middleware/auth.middleware';

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
  | 'TOPUP_SELECT_AMOUNT'
  | 'TOPUP_CUSTOM_AMOUNT'
  | 'CHANGE_PIN_CURRENT'
  | 'CHANGE_PIN_NEW'
  | 'CHANGE_PIN_CONFIRM';

// ─── Bot Service (Stateful Conversation Engine) ─────────

export class BotService {
  private wa = new WhatsAppService();
  private users = new UserService();
  private wallets = new WalletService();
  private transactions = new TransactionService();
  private paymentLinks = new PaymentLinkService();

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
        return this.startPayFlow(from, userId);
      case 'charge':
        return this.startChargeFlow(from, userId, rawText);
      case 'balance':
        return this.showBalance(from, userId);
      case 'topup':
        return this.startTopUpFlow(from);
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
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PAY FLOW (Stateful)
  // ═══════════════════════════════════════════════════════

  private async startPayFlow(from: string, userId: string): Promise<void> {
    await setSession(from, {
      userId,
      waId: from,
      state: 'PAY_ENTER_PHONE',
      data: {},
      lastActivity: Date.now(),
    });

    await this.wa.sendTextMessage(
      from,
      '¿A quién le quieres pagar?\n\nEscribe el número de teléfono (ej: +56912345678):',
    );
  }

  private async handlePayFlow(
    from: string,
    userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    switch (session.state as State) {
      case 'PAY_ENTER_PHONE': {
        // Find receiver
        const phone = text.replace(/[\s\-+]/g, '');
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

        await this.wa.sendTextMessage(
          from,
          `Pagar a: ${session.data.receiverName}\n\n¿Cuánto quieres enviar? (en pesos CLP):`,
        );
        return;
      }

      case 'PAY_ENTER_AMOUNT': {
        const amount = parseInt(text.replace(/[$.]/g, ''), 10);
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

        // Notify sender
        await this.wa.sendTextMessage(
          from,
          [
            'Pago enviado!',
            receipt([
              `${formatCLP(sdn(session.data, 'amount'))} -> ${sd(session.data, 'receiverName')}`,
              `Ref: ${payment.reference}`,
              `Saldo: ${payment.senderBalance}`,
            ]),
          ].join('\n'),
        );

        // Notify receiver
        const sender = await this.users.getUserByWaId(from);
        await this.wa.sendButtonMessage(
          sd(session.data, 'receiverPhone'),
          [
            'Tienes un pago!',
            receipt([
              `${sender?.name || formatPhone(from)} te envió ${formatCLP(sdn(session.data, 'amount'))}`,
              `Ref: ${payment.reference}`,
            ]),
          ].join('\n'),
          [
            { id: 'cmd_balance', title: 'Ver saldo' },
            { id: 'cmd_history', title: 'Historial' },
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
          'Comparte este enlace con tu cliente por WhatsApp.',
        ].join('\n'),
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
    await this.wa.sendTextMessage(from, '¿Cuánto quieres cobrar? (en pesos CLP):');
  }

  private async handleChargeFlow(
    from: string,
    userId: string,
    text: string,
    session: ConversationSession,
  ): Promise<void> {
    switch (session.state as State) {
      case 'CHARGE_ENTER_AMOUNT': {
        const amount = parseInt(text.replace(/[$.]/g, ''), 10);
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
        const link = await this.paymentLinks.createLink({
          merchantId: userId,
          amount: sdn(session.data, 'amount'),
          description,
        });

        await deleteSession(from);

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
            'Comparte este enlace con tu cliente.',
          ].join('\n'),
        );
        return;
      }
    }
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
    const limits: Record<string, string> = {
      BASIC: '$200.000/mes',
      INTERMEDIATE: '$2.000.000/mes',
      FULL: 'Sin límite',
    };

    await this.wa.sendTextMessage(
      from,
      [
        'Tu perfil WhatPay:',
        divider(),
        `Nombre: ${user.name || 'Sin nombre'}`,
        `Nivel: ${user.kycLevel}`,
        `Límite: ${limits[user.kycLevel] || limits.BASIC}`,
        `Saldo: ${balance.formatted}`,
        `Enviado total: ${formatCLP(stats.totalSent)}`,
        `Recibido total: ${formatCLP(stats.totalReceived)}`,
        `Transacciones: ${stats.txCount}`,
        `Biometría: ${user.biometricEnabled ? 'Activada' : 'No activada'}`,
        divider(),
      ].join('\n'),
    );
  }

  private async startTopUpFlow(from: string): Promise<void> {
    await this.wa.sendButtonMessage(from, '¿Cuánto quieres recargar?', [
      { id: 'topup_10000', title: '$10.000' },
      { id: 'topup_20000', title: '$20.000' },
      { id: 'topup_50000', title: '$50.000' },
    ]);
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
    if (state.startsWith('CHANGE_PIN_')) {
      return this.handleChangePinFlow(from, userId, text, session);
    }

    // Unknown state — reset
    await deleteSession(from);
    await this.sendHelp(from, null);
  }

  private async sendHelp(from: string, name: string | null): Promise<void> {
    await this.wa.sendButtonMessage(
      from,
      [
        `${name ? `Hola ${name}!` : 'Hola!'} Soy WhatPay.`,
        '',
        '/pagar - Enviar dinero',
        '/cobrar [monto] [concepto] - Cobrar',
        '/saldo - Tu saldo',
        '/recargar - Agregar fondos',
        '/historial - Últimas transacciones',
        '/perfil - Tu cuenta',
        '/cambiarpin - Cambiar PIN',
        '/soporte - Ayuda humana',
      ].join('\n'),
      [
        { id: 'cmd_pay', title: 'Enviar pago' },
        { id: 'cmd_charge', title: 'Cobrar' },
        { id: 'cmd_balance', title: 'Ver saldo' },
      ],
    );
  }
}
