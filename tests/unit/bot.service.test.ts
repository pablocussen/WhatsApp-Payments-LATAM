/**
 * Unit tests for BotService conversation engine.
 * All dependencies (WhatsApp, DB sessions, services) are fully mocked.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test', ENCRYPTION_KEY_HEX: '0'.repeat(64) },
}));

// ─── Database session mocks ───────────────────────────────

const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockDeleteSession = jest.fn();

jest.mock('../../src/config/database', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  setSession: (...args: unknown[]) => mockSetSession(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  prisma: {},
}));

// ─── Crypto mocks (hashPin/verifyPinHash use bcrypt — speed) ─

const mockHashPin = jest.fn();
const mockVerifyPinHash = jest.fn();

jest.mock('../../src/utils/crypto', () => {
  const actual = jest.requireActual('../../src/utils/crypto');
  return {
    ...actual,
    hashPin: (...args: unknown[]) => mockHashPin(...args),
    verifyPinHash: (...args: unknown[]) => mockVerifyPinHash(...args),
  };
});

// ─── Service mocks ────────────────────────────────────────

const mockWa = {
  sendTextMessage: jest.fn(),
  sendButtonMessage: jest.fn(),
};

const mockUsers = {
  getUserByWaId: jest.fn(),
  getUserById: jest.fn(),
  createUser: jest.fn(),
  verifyUserPin: jest.fn(),
  setNewPin: jest.fn(),
  updateKycLevel: jest.fn(),
};

const mockWallets = {
  getBalance: jest.fn(),
};

const mockTransactions = {
  processP2PPayment: jest.fn(),
  getTransactionHistory: jest.fn(),
  getTransactionStats: jest.fn(),
};

const mockPaymentLinks = {
  createLink: jest.fn(),
};

jest.mock('../../src/services/whatsapp.service', () => ({
  WhatsAppService: jest.fn().mockImplementation(() => mockWa),
}));

jest.mock('../../src/services/user.service', () => ({
  UserService: jest.fn().mockImplementation(() => mockUsers),
}));

jest.mock('../../src/services/wallet.service', () => ({
  WalletService: jest.fn().mockImplementation(() => mockWallets),
  InsufficientFundsError: class extends Error {},
}));

jest.mock('../../src/services/transaction.service', () => ({
  TransactionService: jest.fn().mockImplementation(() => mockTransactions),
}));

jest.mock('../../src/services/payment-link.service', () => ({
  PaymentLinkService: jest.fn().mockImplementation(() => mockPaymentLinks),
}));

import { BotService } from '../../src/services/bot.service';

// ─── Helpers ─────────────────────────────────────────────

const FROM = '+56912345678';
const USER_ID = 'user-uuid-001';
const RECEIVER_ID = 'receiver-uuid-002';
const RECEIVER_WA = '+56987654321';
const MOCKED_HASH = '$2b$12$MOCKED_HASH';

function mkUser(overrides: Record<string, unknown> = {}) {
  return { id: USER_ID, name: 'Juan', kycLevel: 'BASIC', biometricEnabled: false, ...overrides };
}

function mkSession(state: string, data: Record<string, unknown> = {}) {
  return { userId: USER_ID, waId: FROM, state, data, lastActivity: Date.now() };
}

// ─── Test Suite ──────────────────────────────────────────

describe('BotService', () => {
  let bot: BotService;

  beforeEach(() => {
    bot = new BotService();
    jest.clearAllMocks();

    // Resolve void by default
    mockWa.sendTextMessage.mockResolvedValue(undefined);
    mockWa.sendButtonMessage.mockResolvedValue(undefined);
    mockSetSession.mockResolvedValue(undefined);
    mockDeleteSession.mockResolvedValue(undefined);
    mockUsers.setNewPin.mockResolvedValue(undefined);

    // Default: no session, unregistered user
    mockGetSession.mockResolvedValue(null);
    mockUsers.getUserByWaId.mockResolvedValue(null);

    // Crypto defaults
    mockHashPin.mockResolvedValue(MOCKED_HASH);
    mockVerifyPinHash.mockResolvedValue(false);
  });

  // ─── Message routing ─────────────────────────────────────

  describe('handleMessage routing', () => {
    it('starts registration for unregistered user with no session', async () => {
      // Defaults: no session, no user
      await bot.handleMessage(FROM, 'hola');

      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('WhatPay'),
        expect.arrayContaining([expect.objectContaining({ id: 'start_register' })]),
      );
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'REGISTER_RUT' }),
      );
    });

    it('dispatches to registration handler when session state starts with REGISTER', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_RUT'));
      // user still null (in the middle of registration)

      await bot.handleMessage(FROM, '76354771-K'); // valid RUT

      // Routing reached handleRegistration → should advance state
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'REGISTER_PIN' }),
      );
    });

    it('executes saldo command for registered user', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockWallets.getBalance.mockResolvedValue({ formatted: '$15.000 CLP', amount: 15_000 });

      await bot.handleMessage(FROM, 'saldo');

      expect(mockWallets.getBalance).toHaveBeenCalledWith(USER_ID);
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('15.000'),
        expect.any(Array),
      );
    });

    it('sends help for unrecognized message (registered user, no active session)', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'que hay');

      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('/pagar'),
        expect.any(Array),
      );
    });

    it('recognizes cmd_pay button ID and starts PAY flow', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'pay', 'cmd_pay');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'PAY_ENTER_PHONE' }),
      );
    });
  });

  // ─── Registration flow ───────────────────────────────────

  describe('registration flow', () => {
    it('REGISTER_RUT: rejects invalid RUT — no state advance', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_RUT'));

      await bot.handleMessage(FROM, '00000000-0');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('inválido'),
      );
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('REGISTER_RUT: accepts valid RUT and advances to REGISTER_PIN', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_RUT'));

      await bot.handleMessage(FROM, '76354771-K');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({
          state: 'REGISTER_PIN',
          data: expect.objectContaining({ rut: '76354771-K' }),
        }),
      );
    });

    it('REGISTER_PIN: rejects non-6-digit input', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_PIN', { rut: '76354771-K' }));

      await bot.handleMessage(FROM, '12345'); // 5 digits

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('6 dígitos'),
      );
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('REGISTER_PIN: rejects insecure PIN (all same digits)', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_PIN', { rut: '76354771-K' }));

      await bot.handleMessage(FROM, '111111');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('simple'));
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('REGISTER_PIN: accepts secure PIN, hashes it, advances to REGISTER_PIN_CONFIRM', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_PIN', { rut: '76354771-K' }));

      await bot.handleMessage(FROM, '483920');

      expect(mockHashPin).toHaveBeenCalledWith('483920');
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({
          state: 'REGISTER_PIN_CONFIRM',
          data: expect.objectContaining({ pinHash: MOCKED_HASH }),
        }),
      );
    });

    it('REGISTER_PIN_CONFIRM: mismatch resets to REGISTER_PIN', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('REGISTER_PIN_CONFIRM', { rut: '76354771-K', pinHash: MOCKED_HASH }),
      );
      mockVerifyPinHash.mockResolvedValue(false);

      await bot.handleMessage(FROM, '999999');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'REGISTER_PIN' }),
      );
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('no coinciden'),
      );
    });

    it('REGISTER_PIN_CONFIRM: match → createUser succeeds → welcome message + session deleted', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('REGISTER_PIN_CONFIRM', { rut: '76354771-K', pinHash: MOCKED_HASH }),
      );
      mockVerifyPinHash.mockResolvedValue(true);
      mockUsers.createUser.mockResolvedValue({ success: true, userId: USER_ID });

      await bot.handleMessage(FROM, '483920');

      expect(mockUsers.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ waId: FROM, rut: '76354771-K', pin: '483920' }),
      );
      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Bienvenido'),
        expect.any(Array),
      );
    });

    it('REGISTER_PIN_CONFIRM: createUser failure → error shown + session deleted', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('REGISTER_PIN_CONFIRM', { rut: '76354771-K', pinHash: MOCKED_HASH }),
      );
      mockVerifyPinHash.mockResolvedValue(true);
      mockUsers.createUser.mockResolvedValue({ success: false, error: 'RUT ya registrado.' });

      await bot.handleMessage(FROM, '483920');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'RUT ya registrado.');
    });
  });

  // ─── PAY flow ─────────────────────────────────────────────

  describe('PAY flow', () => {
    it('PAY_ENTER_PHONE: unknown receiver → error + deleteSession', async () => {
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PHONE'));
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // initial user check
        .mockResolvedValueOnce(null); // receiver not found

      await bot.handleMessage(FROM, RECEIVER_WA);

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('no tiene WhatPay'),
        expect.any(Array),
      );
    });

    it('PAY_ENTER_PHONE: self-pay → error + deleteSession', async () => {
      const selfUser = mkUser();
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PHONE'));
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(selfUser) // initial user check
        .mockResolvedValueOnce(selfUser); // receiver lookup (same user → self-pay)

      await bot.handleMessage(FROM, FROM);

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('ti mismo'),
      );
    });

    it('PAY_ENTER_PHONE: valid receiver → advances to PAY_ENTER_AMOUNT', async () => {
      const receiver = { id: RECEIVER_ID, name: 'Maria', kycLevel: 'BASIC' };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PHONE'));
      mockUsers.getUserByWaId.mockResolvedValueOnce(mkUser()).mockResolvedValueOnce(receiver);

      await bot.handleMessage(FROM, RECEIVER_WA);

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'PAY_ENTER_AMOUNT' }),
      );
    });

    it('PAY_ENTER_AMOUNT: non-numeric text → error, no state advance', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('PAY_ENTER_AMOUNT', { receiverId: RECEIVER_ID, receiverName: 'Maria' }),
      );
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'mucho');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('inválido'),
      );
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('PAY_CONFIRM: cancellation → deleteSession + "cancelado" message', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('PAY_CONFIRM', { receiverId: RECEIVER_ID, amount: 5_000 }),
      );
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'no');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Pago cancelado.');
    });

    it('PAY_ENTER_PIN: wrong PIN (not locked) → error message, session kept', async () => {
      const sessionData = {
        receiverId: RECEIVER_ID,
        amount: 5_000,
        receiverName: 'Maria',
        receiverPhone: RECEIVER_WA,
      };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({
        success: false,
        message: '2 intentos restantes.',
      });

      await bot.handleMessage(FROM, '000000');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, '2 intentos restantes.');
      expect(mockDeleteSession).not.toHaveBeenCalled();
    });

    it('PAY_ENTER_PIN: locked account → deleteSession + error message', async () => {
      const sessionData = {
        receiverId: RECEIVER_ID,
        amount: 5_000,
        receiverName: 'Maria',
        receiverPhone: RECEIVER_WA,
      };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({
        success: false,
        isLocked: true,
        message: 'Cuenta bloqueada por 15 min.',
      });

      await bot.handleMessage(FROM, '000000');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Cuenta bloqueada por 15 min.');
    });

    it('PAY_ENTER_PIN: correct PIN + successful payment → receipts sent to both parties', async () => {
      const sessionData = {
        receiverId: RECEIVER_ID,
        amount: 5_000,
        receiverName: 'Maria',
        receiverPhone: RECEIVER_WA,
      };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // initial user check
        .mockResolvedValueOnce(mkUser()); // sender name lookup for receiver notification
      mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: '' });
      mockTransactions.processP2PPayment.mockResolvedValue({
        success: true,
        reference: 'WP-2026-AABB1122',
        senderBalance: '$10.000 CLP',
      });

      await bot.handleMessage(FROM, '483920');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('enviado'));
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        RECEIVER_WA,
        expect.stringContaining('pago'),
        expect.any(Array),
      );
    });
  });

  // ─── CHARGE flow ─────────────────────────────────────────

  describe('CHARGE flow', () => {
    it('quick charge "/cobrar 3500 Café" creates link without entering session', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockPaymentLinks.createLink.mockResolvedValue({
        amountFormatted: '$3.500 CLP',
        url: 'https://whatpay.cl/p/ABC123',
      });

      await bot.handleMessage(FROM, '/cobrar 3500 Café');

      expect(mockPaymentLinks.createLink).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId: USER_ID, amount: 3500, description: 'Café' }),
      );
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'));
    });

    it('CHARGE_ENTER_AMOUNT: amount below $100 → error, no state advance', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHARGE_ENTER_AMOUNT'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '50');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('inválido'),
      );
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('CHARGE_ENTER_AMOUNT: valid amount → advances to CHARGE_ENTER_DESCRIPTION', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHARGE_ENTER_AMOUNT'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '8500');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHARGE_ENTER_DESCRIPTION' }),
      );
    });

    it('CHARGE_ENTER_DESCRIPTION: creates link + deleteSession', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHARGE_ENTER_DESCRIPTION', { amount: 8_500 }));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockPaymentLinks.createLink.mockResolvedValue({
        amountFormatted: '$8.500 CLP',
        url: 'https://whatpay.cl/p/XYZ789',
      });

      await bot.handleMessage(FROM, 'Café con leche');

      expect(mockPaymentLinks.createLink).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 8_500, description: 'Café con leche' }),
      );
      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('XYZ789'));
    });
  });

  // ─── CHANGE_PIN flow ─────────────────────────────────────

  describe('CHANGE_PIN flow', () => {
    it('CHANGE_PIN_CURRENT: wrong PIN (not locked) → error, session kept', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHANGE_PIN_CURRENT'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({
        success: false,
        message: '2 intentos restantes.',
      });

      await bot.handleMessage(FROM, '000000');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, '2 intentos restantes.');
      expect(mockDeleteSession).not.toHaveBeenCalled();
    });

    it('CHANGE_PIN_CURRENT: account locked → deleteSession + error', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHANGE_PIN_CURRENT'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({
        success: false,
        isLocked: true,
        message: 'Cuenta bloqueada por 15 min.',
      });

      await bot.handleMessage(FROM, '000000');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Cuenta bloqueada por 15 min.');
    });

    it('CHANGE_PIN_NEW: insecure PIN (sequential) → error, no advance', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHANGE_PIN_NEW'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '123456');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('inseguro'),
      );
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('CHANGE_PIN_CONFIRM: mismatch → back to CHANGE_PIN_NEW', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('CHANGE_PIN_CONFIRM', { newPinHash: MOCKED_HASH }),
      );
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockVerifyPinHash.mockResolvedValue(false);

      await bot.handleMessage(FROM, '999999');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHANGE_PIN_NEW' }),
      );
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('No coinciden'),
      );
    });

    it('CHANGE_PIN_CONFIRM: match → setNewPin called + deleteSession + success message', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('CHANGE_PIN_CONFIRM', { newPinHash: MOCKED_HASH }),
      );
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockVerifyPinHash.mockResolvedValue(true);

      await bot.handleMessage(FROM, '483920');

      expect(mockUsers.setNewPin).toHaveBeenCalledWith(FROM, '483920');
      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('actualizado'),
      );
    });

    it('CHANGE_PIN_CURRENT: correct PIN → advances to CHANGE_PIN_NEW', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHANGE_PIN_CURRENT'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: 'OK' });

      await bot.handleMessage(FROM, '483920');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHANGE_PIN_NEW' }),
      );
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('nuevo PIN'),
      );
    });

    it('CHANGE_PIN_NEW: valid secure PIN → hashes and advances to CHANGE_PIN_CONFIRM', async () => {
      mockGetSession.mockResolvedValue(mkSession('CHANGE_PIN_NEW'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '483920'); // secure PIN

      expect(mockHashPin).toHaveBeenCalledWith('483920');
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHANGE_PIN_CONFIRM' }),
      );
    });
  });

  // ─── Additional routing & edge cases ─────────────────────

  describe('additional coverage', () => {
    it('PAY_ENTER_AMOUNT: valid amount → fetches balance + sends confirm receipt', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('PAY_ENTER_AMOUNT', { receiverId: RECEIVER_ID, receiverName: 'María' }),
      );
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockWallets.getBalance.mockResolvedValue({ formatted: '$50.000 CLP', amount: 50_000 });

      await bot.handleMessage(FROM, '5000');

      expect(mockWallets.getBalance).toHaveBeenCalledWith(USER_ID);
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'PAY_CONFIRM' }),
      );
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('50.000'),
        expect.any(Array),
      );
    });

    it('PAY_CONFIRM: "si" confirmation → advances to PAY_ENTER_PIN', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('PAY_CONFIRM', { receiverId: RECEIVER_ID, amount: 5_000 }),
      );
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'si');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'PAY_ENTER_PIN' }),
      );
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('PIN'));
    });

    it('PAY_ENTER_PIN: correct PIN but payment fails → error message', async () => {
      const sessionData = {
        receiverId: RECEIVER_ID,
        amount: 5_000,
        receiverName: 'María',
        receiverPhone: RECEIVER_WA,
      };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: 'OK' });
      mockTransactions.processP2PPayment.mockResolvedValue({
        success: false,
        error: 'Límite mensual alcanzado.',
      });

      await bot.handleMessage(FROM, '483920');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Límite mensual alcanzado.');
    });

    it('handleStatefulFlow: unknown state → deleteSession + help', async () => {
      mockGetSession.mockResolvedValue(mkSession('UNKNOWN_STATE'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'anything');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('/pagar'),
        expect.any(Array),
      );
    });

    it('error in handleMessage → sends generic error message', async () => {
      mockGetSession.mockResolvedValue(null);
      mockUsers.getUserByWaId.mockRejectedValue(new Error('DB exploded'));

      await bot.handleMessage(FROM, 'hola');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('problema'),
      );
    });

    it('/cambiarpin command → sets session to CHANGE_PIN_CURRENT', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '/cambiarpin');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHANGE_PIN_CURRENT' }),
      );
    });

    it('/historial command → sends getTransactionHistory result', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockTransactions.getTransactionHistory.mockResolvedValue('Últimas 2 transacciones:\n─────');

      await bot.handleMessage(FROM, '/historial');

      expect(mockTransactions.getTransactionHistory).toHaveBeenCalledWith(USER_ID);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('transacciones'),
      );
    });

    it('/recargar command → sends top-up options (3 amounts)', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '/recargar');

      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('recargar'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'topup_10000' }),
          expect.objectContaining({ id: 'topup_20000' }),
          expect.objectContaining({ id: 'topup_50000' }),
        ]),
      );
    });

    it('REGISTER_RUT: "start_register" button tap → prompts for RUT', async () => {
      mockGetSession.mockResolvedValue(mkSession('REGISTER_RUT'));

      await bot.handleMessage(FROM, 'start_register');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('RUT'));
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('/soporte command → sends support contact info', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '/soporte');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('soporte@whatpay.cl'),
      );
    });

    it('/perfil command → showProfile sends user stats', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue({
        id: USER_ID,
        name: 'Juan',
        kycLevel: 'BASIC',
        biometricEnabled: false,
        waId: FROM,
        createdAt: new Date(),
      });
      mockWallets.getBalance.mockResolvedValue({ formatted: '$25.000 CLP', amount: 25_000 });
      mockTransactions.getTransactionStats.mockResolvedValue({
        totalSent: 10_000,
        totalReceived: 5_000,
        txCount: 3,
      });

      await bot.handleMessage(FROM, '/perfil');

      expect(mockUsers.getUserById).toHaveBeenCalledWith(USER_ID);
      expect(mockWallets.getBalance).toHaveBeenCalledWith(USER_ID);
      expect(mockTransactions.getTransactionStats).toHaveBeenCalledWith(USER_ID);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('perfil'));
    });

    it('/kyc command on FULL account → informs already at max level', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser({ kycLevel: 'FULL' }));
      mockUsers.getUserById.mockResolvedValue(mkUser({ kycLevel: 'FULL' }));

      await bot.handleMessage(FROM, '/kyc');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('máximo'));
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('/kyc command on INTERMEDIATE account → shows current limits info', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser({ kycLevel: 'INTERMEDIATE' }));
      mockUsers.getUserById.mockResolvedValue(mkUser({ kycLevel: 'INTERMEDIATE' }));

      await bot.handleMessage(FROM, '/kyc');

      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('INTERMEDIATE'),
      );
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('/kyc command on BASIC account → starts KYC_CONFIRM session', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '/kyc');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'KYC_CONFIRM' }),
      );
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('INTERMEDIATE'),
        expect.any(Array),
      );
    });

    it('KYC_CONFIRM: "kyc_confirm" → upgrades to INTERMEDIATE + deleteSession', async () => {
      mockGetSession.mockResolvedValue(mkSession('KYC_CONFIRM'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.updateKycLevel.mockResolvedValue(undefined);

      await bot.handleMessage(FROM, 'kyc_confirm');

      expect(mockUsers.updateKycLevel).toHaveBeenCalledWith(USER_ID, 'INTERMEDIATE');
      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('verificada'),
      );
    });

    it('KYC_CONFIRM: "kyc_cancel" → deleteSession + cancelled message', async () => {
      mockGetSession.mockResolvedValue(mkSession('KYC_CONFIRM'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'kyc_cancel');

      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('cancelada'),
      );
    });

    it('KYC_CONFIRM: unknown text → prompts to confirm or cancel', async () => {
      mockGetSession.mockResolvedValue(mkSession('KYC_CONFIRM'));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, 'no sé');

      expect(mockUsers.updateKycLevel).not.toHaveBeenCalled();
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Confirmar'),
      );
    });

    it('/ayuda command → dispatches to case "help" (getUserByWaId for name)', async () => {
      // First call: check if user registered; Second call: inside case 'help': for name
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // handleMessage: user is registered
        .mockResolvedValueOnce(mkUser()); // case 'help': get name
      await bot.handleMessage(FROM, '/ayuda');
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('/pagar'),
        expect.any(Array),
      );
    });

    it('/ayuda command → sendHelp with null when second getUserByWaId returns user with null name', async () => {
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // registered check
        .mockResolvedValueOnce({ ...mkUser(), name: null }); // case 'help': null name
      await bot.handleMessage(FROM, '/ayuda');
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.any(String),
        expect.any(Array),
      );
    });

    it('/cobrar alone (no args) → starts interactive CHARGE_ENTER_AMOUNT session', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());

      await bot.handleMessage(FROM, '/cobrar');

      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHARGE_ENTER_AMOUNT' }),
      );
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Cuánto quieres cobrar'),
      );
    });

    // ── PAY_ENTER_PHONE branch coverage ──────────────────────

    it('PAY_ENTER_PHONE: phone without 56 prefix → normalizes to 56XXXXXXXXX', async () => {
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PHONE'));
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // initial registered check
        .mockResolvedValueOnce(null); // receiver not found after normalization
      await bot.handleMessage(FROM, '987654321'); // no country code
      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('no tiene WhatPay'),
        expect.any(Array),
      );
    });

    it('PAY_ENTER_PHONE: receiver with null name → falls back to formatPhone', async () => {
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PHONE'));
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // sender registered
        .mockResolvedValueOnce({
          id: RECEIVER_ID,
          name: null,
          kycLevel: 'BASIC',
          biometricEnabled: false,
          waId: RECEIVER_WA,
        });
      await bot.handleMessage(FROM, RECEIVER_WA);
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'PAY_ENTER_AMOUNT' }),
      );
    });

    // ── PAY_ENTER_PIN branch coverage ─────────────────────────

    it('PAY_ENTER_PIN: payment fails without error field → default fallback message', async () => {
      const sessionData = {
        receiverId: RECEIVER_ID,
        amount: 5_000,
        receiverName: 'María',
        receiverPhone: RECEIVER_WA,
      };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: '' });
      mockTransactions.processP2PPayment.mockResolvedValue({ success: false }); // no error field
      await bot.handleMessage(FROM, '483920');
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Error al procesar el pago.');
    });

    it('PAY_ENTER_PIN: success with null sender lookup → formatPhone fallback in notification', async () => {
      const sessionData = {
        receiverId: RECEIVER_ID,
        amount: 5_000,
        receiverName: 'María',
        receiverPhone: RECEIVER_WA,
      };
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // initial registered check
        .mockResolvedValueOnce(null); // sender lookup → null → covers sender?.name || formatPhone(from)
      mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: '' });
      mockTransactions.processP2PPayment.mockResolvedValue({
        success: true,
        reference: 'WP-TEST-001',
        senderBalance: '$5.000 CLP',
      });
      await bot.handleMessage(FROM, '483920');
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        RECEIVER_WA,
        expect.stringContaining('pago'),
        expect.any(Array),
      );
    });

    it('PAY_ENTER_PIN: empty session data → sd/sdn fallback to "" and 0', async () => {
      mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', {})); // no receiverId, amount
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: '' });
      mockTransactions.processP2PPayment.mockResolvedValue({ success: false });
      await bot.handleMessage(FROM, '483920');
      expect(mockTransactions.processP2PPayment).toHaveBeenCalledWith(
        expect.objectContaining({ receiverId: '', amount: 0 }),
      );
    });

    // ── /cobrar description fallback ──────────────────────────

    it('/cobrar with amount but no description → uses "Pago" as default', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockPaymentLinks.createLink.mockResolvedValue({
        amountFormatted: '$3.500 CLP',
        url: 'https://whatpay.cl/p/DEF456',
      });
      await bot.handleMessage(FROM, '/cobrar 3500'); // no description
      expect(mockPaymentLinks.createLink).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Pago' }),
      );
    });

    // ── showProfile branch coverage ───────────────────────────

    it('/perfil command → silent no-op when getUserById returns null', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue(null);
      await bot.handleMessage(FROM, '/perfil');
      expect(mockWa.sendTextMessage).not.toHaveBeenCalled();
    });

    it('/perfil command → shows "Sin nombre" when user.name is null', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue({
        id: USER_ID,
        name: null,
        kycLevel: 'BASIC',
        biometricEnabled: false,
        waId: FROM,
        createdAt: new Date(),
      });
      mockWallets.getBalance.mockResolvedValue({ formatted: '$0 CLP', amount: 0 });
      mockTransactions.getTransactionStats.mockResolvedValue({
        totalSent: 0,
        totalReceived: 0,
        txCount: 0,
      });
      await bot.handleMessage(FROM, '/perfil');
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Sin nombre'),
      );
    });

    it('/perfil command → falls back to BASIC limits for unknown kycLevel', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue({
        id: USER_ID,
        name: 'Juan',
        kycLevel: 'PREMIUM',
        biometricEnabled: false,
        waId: FROM,
        createdAt: new Date(),
      });
      mockWallets.getBalance.mockResolvedValue({ formatted: '$0 CLP', amount: 0 });
      mockTransactions.getTransactionStats.mockResolvedValue({
        totalSent: 0,
        totalReceived: 0,
        txCount: 0,
      });
      await bot.handleMessage(FROM, '/perfil');
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('200.000'));
    });

    it('/perfil command → shows "Activada" when biometricEnabled is true', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue({
        id: USER_ID,
        name: 'Juan',
        kycLevel: 'BASIC',
        biometricEnabled: true,
        waId: FROM,
        createdAt: new Date(),
      });
      mockWallets.getBalance.mockResolvedValue({ formatted: '$0 CLP', amount: 0 });
      mockTransactions.getTransactionStats.mockResolvedValue({
        totalSent: 0,
        totalReceived: 0,
        txCount: 0,
      });
      await bot.handleMessage(FROM, '/perfil');
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Activada'),
      );
    });

    // ── KYC + registration branch coverage ───────────────────

    it('/kyc command → silent no-op when getUserById returns null', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      mockUsers.getUserById.mockResolvedValue(null);
      await bot.handleMessage(FROM, '/kyc');
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('REGISTER_PIN_CONFIRM: createUser fails without error field → default error message', async () => {
      mockGetSession.mockResolvedValue(
        mkSession('REGISTER_PIN_CONFIRM', { rut: '76354771-K', pinHash: MOCKED_HASH }),
      );
      mockVerifyPinHash.mockResolvedValue(true);
      mockUsers.createUser.mockResolvedValue({ success: false }); // no error field
      await bot.handleMessage(FROM, '483920');
      expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Error al crear la cuenta.');
    });

    it('text command "pagar" (no slash) → routes to PAY flow (covers || exact-match branch)', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser());
      await bot.handleMessage(FROM, 'pagar');
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'PAY_ENTER_PHONE' }),
      );
    });
  });
});
