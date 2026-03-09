/**
 * Unit tests for BotService conversation engine.
 * All dependencies (WhatsApp, DB sessions, services) are fully mocked.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    ENCRYPTION_KEY_HEX: '0'.repeat(64),
    APP_BASE_URL: 'http://localhost:3000',
  },
}));

// ─── Database session mocks ───────────────────────────────

const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockDeleteSession = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../../src/config/database', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  setSession: (...args: unknown[]) => mockSetSession(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  getRedis: jest.fn().mockReturnValue({ set: (...args: unknown[]) => mockRedisSet(...args) }),
  prisma: {},
}));

// ─── Crypto mocks (hashPin/verifyPinHash use bcrypt — speed) ─

const mockHashPin = jest.fn();
const mockVerifyPinHash = jest.fn();
const mockGenerateReference = jest.fn().mockReturnValue('#WP-2026-AABBCCDD');

jest.mock('../../src/utils/crypto', () => {
  const actual = jest.requireActual('../../src/utils/crypto');
  return {
    ...actual,
    hashPin: (...args: unknown[]) => mockHashPin(...args),
    verifyPinHash: (...args: unknown[]) => mockVerifyPinHash(...args),
    generateReference: (...args: unknown[]) => mockGenerateReference(...args),
  };
});

// ─── Service mocks ────────────────────────────────────────

const mockWa = {
  sendTextMessage: jest.fn(),
  sendButtonMessage: jest.fn(),
  sendListMessage: jest.fn(),
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
  getRecentRecipients: jest.fn(),
  getTransactionByReference: jest.fn(),
  refundTransaction: jest.fn(),
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

const mockKhipu = {
  createPayment: jest.fn(),
};

jest.mock('../../src/services/khipu.service', () => ({
  KhipuService: jest.fn().mockImplementation(() => mockKhipu),
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
    mockWa.sendListMessage.mockResolvedValue(undefined);
    mockSetSession.mockResolvedValue(undefined);
    mockDeleteSession.mockResolvedValue(undefined);
    mockUsers.setNewPin.mockResolvedValue(undefined);

    // Default: no session, unregistered user
    mockGetSession.mockResolvedValue(null);
    mockUsers.getUserByWaId.mockResolvedValue(null);

    // Crypto defaults
    mockHashPin.mockResolvedValue(MOCKED_HASH);
    mockVerifyPinHash.mockResolvedValue(false);

    // Default: no recent recipients
    mockTransactions.getRecentRecipients.mockResolvedValue([]);
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

      expect(mockWa.sendListMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('WhatPay'),
        expect.any(String),
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
      // Sender receipt (button message with "Otro pago" action)
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('enviado'),
        expect.arrayContaining([expect.objectContaining({ id: 'cmd_pay' })]),
      );
      // Receiver notification (with "Devolver pago" action)
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        RECEIVER_WA,
        expect.stringContaining('pago'),
        expect.arrayContaining([expect.objectContaining({ id: 'cmd_pay' })]),
      );
    });
  });

  // ─── CHARGE flow ─────────────────────────────────────────

  describe('CHARGE flow', () => {
    it('quick charge "/cobrar 3500 Café" creates link and offers to send', async () => {
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
      // Now offers to send via WhatsApp
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHARGE_SEND_LINK' }),
      );
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('enviar el cobro'),
        expect.arrayContaining([expect.objectContaining({ id: 'charge_send_yes' })]),
      );
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

    it('CHARGE_ENTER_DESCRIPTION: creates link and transitions to CHARGE_SEND_LINK', async () => {
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
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('XYZ789'));
      // Transitions to CHARGE_SEND_LINK instead of deleting session
      expect(mockSetSession).toHaveBeenCalledWith(
        FROM,
        expect.objectContaining({ state: 'CHARGE_SEND_LINK', data: expect.objectContaining({ linkUrl: 'https://whatpay.cl/p/XYZ789' }) }),
      );
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
      expect(mockWa.sendListMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('WhatPay'),
        expect.any(String),
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
        monthlySent: 5_000,
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
      expect(mockWa.sendListMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('WhatPay'),
        expect.any(String),
        expect.any(Array),
      );
    });

    it('/ayuda command → sendHelp with null when second getUserByWaId returns user with null name', async () => {
      mockUsers.getUserByWaId
        .mockResolvedValueOnce(mkUser()) // registered check
        .mockResolvedValueOnce({ ...mkUser(), name: null }); // case 'help': null name
      await bot.handleMessage(FROM, '/ayuda');
      expect(mockWa.sendListMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Hola!'),
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
      expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Cuánto quieres cobrar'),
        expect.arrayContaining([expect.objectContaining({ id: 'amt_5000' })]),
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
        monthlySent: 0,
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
        monthlySent: 0,
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
        monthlySent: 0,
      });
      await bot.handleMessage(FROM, '/perfil');
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Activada'),
      );
    });

    it('/perfil command → FULL kycLevel shows "Sin límite" (covers FULL branch)', async () => {
      mockUsers.getUserByWaId.mockResolvedValue(mkUser({ kycLevel: 'FULL' }));
      mockUsers.getUserById.mockResolvedValue({
        id: USER_ID,
        name: 'Juan',
        kycLevel: 'FULL',
        biometricEnabled: false,
        waId: FROM,
        createdAt: new Date(),
      });
      mockWallets.getBalance.mockResolvedValue({ formatted: '$500.000 CLP', amount: 500_000 });
      mockTransactions.getTransactionStats.mockResolvedValue({
        totalSent: 100_000,
        totalReceived: 50_000,
        txCount: 5,
        monthlySent: 80_000,
      });
      await bot.handleMessage(FROM, '/perfil');
      expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
        FROM,
        expect.stringContaining('Sin límite'),
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

// ─── /cancelar command ───────────────────────────────────

describe('BotService — /cancelar command', () => {
  let bot: BotService;

  beforeEach(() => {
    bot = new BotService();
    jest.clearAllMocks();
    mockWa.sendTextMessage.mockResolvedValue(undefined);
    mockWa.sendButtonMessage.mockResolvedValue(undefined);
    mockWa.sendListMessage.mockResolvedValue(undefined);
    mockSetSession.mockResolvedValue(undefined);
    mockDeleteSession.mockResolvedValue(undefined);
  });

  it('/cancelar in mid-flow → deletes session, sends confirmation, shows help', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_AMOUNT'));

    await bot.handleMessage(FROM, '/cancelar');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Operación cancelada.');
    expect(mockWa.sendListMessage).toHaveBeenCalled();
  });

  it('"cancelar" text (no slash) → same cancel behaviour', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(null);

    await bot.handleMessage(FROM, 'cancelar');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Operación cancelada.');
  });

  it('/cancelar when user has null name → sendHelp with null name', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser({ name: null }));
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, '/cancelar');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendListMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Hola!'),
      expect.any(String),
      expect.any(Array),
    );
  });
});

// ─── TOPUP flow ───────────────────────────────────────────

describe('BotService — /recargar → TOPUP flow', () => {
  let bot: BotService;

  beforeEach(() => {
    bot = new BotService();
    jest.clearAllMocks();
    mockWa.sendTextMessage.mockResolvedValue(undefined);
    mockWa.sendButtonMessage.mockResolvedValue(undefined);
    mockWa.sendListMessage.mockResolvedValue(undefined);
    mockSetSession.mockResolvedValue(undefined);
    mockDeleteSession.mockResolvedValue(undefined);
    mockRedisSet.mockResolvedValue('OK');
    mockKhipu.createPayment.mockResolvedValue({
      paymentId: 'khipu-pay-id-001',
      paymentUrl: 'https://khipu.com/payment/khipu-pay-id-001',
      simplifiedTransferUrl: 'https://khipu.com/simplified/khipu-pay-id-001',
      appUrl: 'khipu://pay/khipu-pay-id-001',
    });
  });

  it('/recargar command creates TOPUP_SELECT_AMOUNT session and sends amount buttons', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(null);

    await bot.handleMessage(FROM, '/recargar');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'TOPUP_SELECT_AMOUNT', userId: USER_ID }),
    );
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('recargar'),
      expect.arrayContaining([expect.objectContaining({ id: 'topup_10000' })]),
    );
  });

  it('TOPUP_SELECT_AMOUNT: topup_10000 button → calls Khipu, stores Redis, sends payment URL', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, 'topup_10000', 'topup_10000');

    expect(mockKhipu.createPayment).toHaveBeenCalledWith(
      expect.stringContaining('$10.000'),
      10000,
      expect.stringContaining('/khipu/notify'),
      expect.stringContaining('/topup/success'),
      '#WP-2026-AABBCCDD',
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      'topup:khipu:khipu-pay-id-001',
      expect.stringContaining('"userId":"user-uuid-001"'),
      { EX: 3600 },
    );
    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('https://khipu.com/payment/khipu-pay-id-001'),
    );
  });

  it('TOPUP_SELECT_AMOUNT: topup_20000 button → amount 20000 passed to Khipu', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, 'topup_20000', 'topup_20000');

    expect(mockKhipu.createPayment).toHaveBeenCalledWith(
      expect.any(String),
      20000,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('TOPUP_SELECT_AMOUNT: topup_50000 button → amount 50000 passed to Khipu', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, 'topup_50000', 'topup_50000');

    expect(mockKhipu.createPayment).toHaveBeenCalledWith(
      expect.any(String),
      50000,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('TOPUP_SELECT_AMOUNT: custom text amount 25000 → calls Khipu with 25000', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, '25000');

    expect(mockKhipu.createPayment).toHaveBeenCalledWith(
      expect.any(String),
      25000,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('TOPUP_SELECT_AMOUNT: invalid text "abc" → error message, session not deleted', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, 'abc');

    expect(mockKhipu.createPayment).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Monto inválido'),
    );
  });

  it('TOPUP_SELECT_AMOUNT: amount 500 (below $1.000) → validation error', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, '500');

    expect(mockKhipu.createPayment).not.toHaveBeenCalled();
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Monto inválido'),
    );
  });

  it('TOPUP_SELECT_AMOUNT: amount 600000 (above $500.000) → validation error', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));

    await bot.handleMessage(FROM, '600000');

    expect(mockKhipu.createPayment).not.toHaveBeenCalled();
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Monto inválido'),
    );
  });

  it('TOPUP_SELECT_AMOUNT: Khipu throws → sends error, deletes session, rethrows', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(mkSession('TOPUP_SELECT_AMOUNT'));
    mockKhipu.createPayment.mockRejectedValue(new Error('Khipu API timeout'));

    await bot.handleMessage(FROM, 'topup_10000', 'topup_10000');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Error al generar el link'),
    );
  });
});

// ─── CHARGE_SEND_LINK flow (auto-notification) ──────────

describe('BotService — CHARGE_SEND_LINK flow', () => {
  let bot: BotService;

  beforeEach(() => {
    bot = new BotService();
    jest.clearAllMocks();
    mockWa.sendTextMessage.mockResolvedValue(undefined);
    mockWa.sendButtonMessage.mockResolvedValue(undefined);
    mockWa.sendListMessage.mockResolvedValue(undefined);
    mockSetSession.mockResolvedValue(undefined);
    mockDeleteSession.mockResolvedValue(undefined);
  });

  it('CHARGE_SEND_LINK: decline with "no" button → deletes session', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_SEND_LINK', { linkUrl: 'https://whatpay.cl/p/ABC', linkAmount: 3500, linkDescription: 'Café' }),
    );

    await bot.handleMessage(FROM, 'charge_send_no');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).not.toHaveBeenCalledWith(
      expect.stringMatching(/56/),
      expect.any(String),
    );
  });

  it('CHARGE_SEND_LINK: accept → transitions to CHARGE_ENTER_PHONE', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_SEND_LINK', { linkUrl: 'https://whatpay.cl/p/ABC', linkAmount: 3500, linkDescription: 'Café' }),
    );

    await bot.handleMessage(FROM, 'charge_send_yes');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'CHARGE_ENTER_PHONE' }),
    );
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('número de WhatsApp'),
    );
  });

  it('CHARGE_SEND_LINK: direct phone input → sends charge to that phone', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_SEND_LINK', { linkUrl: 'https://whatpay.cl/p/ABC', linkAmount: 3500, linkDescription: 'Café' }),
    );

    await bot.handleMessage(FROM, '+56987654321');

    // Should send the charge to the target phone
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      '56987654321',
      expect.stringContaining('whatpay.cl/p/ABC'),
    );
    // Confirm to sender
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Cobro enviado'),
    );
    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
  });

  it('CHARGE_SEND_LINK: invalid phone → error message, stays in state', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_SEND_LINK', { linkUrl: 'https://whatpay.cl/p/ABC', linkAmount: 3500, linkDescription: 'Café' }),
    );

    await bot.handleMessage(FROM, '123');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Número inválido'),
    );
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('CHARGE_SEND_LINK: merchant has null name → shows "Alguien"', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser({ name: null })) // registered check
      .mockResolvedValueOnce(null); // merchant lookup returns null
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_SEND_LINK', { linkUrl: 'https://whatpay.cl/p/XY', linkAmount: 5000, linkDescription: 'Test' }),
    );

    await bot.handleMessage(FROM, '56987654321');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      '56987654321',
      expect.stringContaining('Alguien'),
    );
  });

  it('CHARGE_ENTER_PHONE: valid phone → sends charge notification', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_ENTER_PHONE', { linkUrl: 'https://whatpay.cl/p/DEF', linkAmount: 8500, linkDescription: 'Almuerzo' }),
    );

    await bot.handleMessage(FROM, '56987654321');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      '56987654321',
      expect.stringContaining('whatpay.cl/p/DEF'),
    );
    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
  });

  it('CHARGE_ENTER_PHONE: invalid phone → error stays in state', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_ENTER_PHONE', { linkUrl: 'https://whatpay.cl/p/DEF', linkAmount: 8500, linkDescription: 'Almuerzo' }),
    );

    await bot.handleMessage(FROM, 'abc');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Número inválido'),
    );
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('CHARGE_ENTER_PHONE: merchant with name → includes name in notification', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser({ name: 'Juan' }));
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_ENTER_PHONE', { linkUrl: 'https://whatpay.cl/p/GHI', linkAmount: 2000, linkDescription: 'Pan' }),
    );

    await bot.handleMessage(FROM, '56987654321');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      '56987654321',
      expect.stringContaining('Juan'),
    );
  });

  it('CHARGE_ENTER_PHONE: merchant null name → shows "Alguien"', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser({ name: null })) // registered check
      .mockResolvedValueOnce(null); // merchant lookup
    mockGetSession.mockResolvedValue(
      mkSession('CHARGE_ENTER_PHONE', { linkUrl: 'https://whatpay.cl/p/JKL', linkAmount: 1500, linkDescription: 'Jugo' }),
    );

    await bot.handleMessage(FROM, '56987654321');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      '56987654321',
      expect.stringContaining('Alguien'),
    );
  });

  // ── Recent contacts in startPayFlow ─────────────────────

  it('startPayFlow: with recent recipients → shows sendButtonMessage with rcpt_ buttons', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockTransactions.getRecentRecipients.mockResolvedValue([
      { id: 'r1', name: 'Maria', waId: '56987654321' },
      { id: 'r2', name: null, waId: '56911223344' },
    ]);

    await bot.handleMessage(FROM, '/pagar');

    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('contacto reciente'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'rcpt_56987654321', title: 'Maria' }),
        expect.objectContaining({ id: 'rcpt_56911223344' }),
      ]),
    );
  });

  it('startPayFlow: no recent recipients → shows sendTextMessage with phone prompt', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockTransactions.getRecentRecipients.mockResolvedValue([]);

    await bot.handleMessage(FROM, '/pagar');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('número de teléfono'),
    );
    expect(mockWa.sendButtonMessage).not.toHaveBeenCalled();
  });

  it('PAY_ENTER_PHONE: rcpt_ button click resolves as phone number', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // registered check
      .mockResolvedValueOnce(mkUser({ id: RECEIVER_ID, name: 'Maria', waId: RECEIVER_WA })); // receiver lookup
    mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PHONE'));

    await bot.handleMessage(FROM, 'rcpt_56987654321');

    // Should advance to PAY_ENTER_AMOUNT with receiver info
    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        state: 'PAY_ENTER_AMOUNT',
        data: expect.objectContaining({
          receiverId: RECEIVER_ID,
          receiverPhone: '56987654321',
        }),
      }),
    );
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Cuánto quieres enviar'),
      expect.arrayContaining([expect.objectContaining({ id: 'amt_5000' })]),
    );
  });

  // ── Payment receipt timestamps ──────────────────────────

  it('PAY_ENTER_PIN: receipt includes Fecha timestamp', async () => {
    const sessionData = {
      receiverId: RECEIVER_ID,
      amount: 5_000,
      receiverName: 'Maria',
      receiverPhone: RECEIVER_WA,
    };
    mockGetSession.mockResolvedValue(mkSession('PAY_ENTER_PIN', sessionData));
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // initial user check
      .mockResolvedValueOnce(mkUser()); // sender name lookup
    mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: '' });
    mockTransactions.processP2PPayment.mockResolvedValue({
      success: true,
      reference: 'WP-2026-AABB1122',
      senderBalance: '$10.000 CLP',
    });

    await bot.handleMessage(FROM, '483920');

    // Sender receipt includes Fecha (button message with actions)
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Fecha:'),
      expect.any(Array),
    );
    // Receiver notification includes Fecha
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      RECEIVER_WA,
      expect.stringContaining('Fecha:'),
      expect.any(Array),
    );
  });

  // ── Quick-pay shortcut ──────────────────────────────────

  it('quick-pay: "/pagar 56987654321 5000" skips to PAY_CONFIRM', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // registered check
      .mockResolvedValueOnce(mkUser({ id: RECEIVER_ID, name: 'Maria', waId: RECEIVER_WA })); // receiver lookup
    mockWallets.getBalance.mockResolvedValue({ formatted: '$50.000 CLP', raw: 50000 });

    await bot.handleMessage(FROM, '/pagar 56987654321 5000');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        state: 'PAY_CONFIRM',
        data: expect.objectContaining({
          receiverId: RECEIVER_ID,
          amount: 5000,
        }),
      }),
    );
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('$5.000'),
      expect.arrayContaining([expect.objectContaining({ id: 'confirm_pay' })]),
    );
  });

  it('quick-pay: receiver not found → falls back to normal flow', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // registered check
      .mockResolvedValueOnce(null); // receiver not found

    await bot.handleMessage(FROM, '/pagar 56999999999 5000');

    // Should fall through to normal startPayFlow (PAY_ENTER_PHONE)
    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'PAY_ENTER_PHONE' }),
    );
  });

  it('quick-pay: self-payment → falls back to normal flow', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // registered check
      .mockResolvedValueOnce(mkUser({ id: USER_ID })); // receiver = self

    await bot.handleMessage(FROM, '/pagar 56987654321 5000');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'PAY_ENTER_PHONE' }),
    );
  });

  it('quick-pay: invalid amount → falls back to normal flow', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());

    await bot.handleMessage(FROM, '/pagar 56987654321 abc');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'PAY_ENTER_PHONE' }),
    );
  });

  // ── Amount quick-select buttons ─────────────────────────

  it('PAY_ENTER_AMOUNT: amt_10000 button → uses 10000 as amount', async () => {
    mockGetSession.mockResolvedValue(
      mkSession('PAY_ENTER_AMOUNT', { receiverId: RECEIVER_ID, receiverName: 'Maria', receiverPhone: RECEIVER_WA }),
    );
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockWallets.getBalance.mockResolvedValue({ formatted: '$50.000 CLP', raw: 50000 });

    await bot.handleMessage(FROM, 'amt_10000');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        state: 'PAY_CONFIRM',
        data: expect.objectContaining({ amount: 10000 }),
      }),
    );
  });

  it('CHARGE_ENTER_AMOUNT: amt_5000 button → uses 5000 as amount', async () => {
    mockGetSession.mockResolvedValue(mkSession('CHARGE_ENTER_AMOUNT'));
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());

    await bot.handleMessage(FROM, 'amt_5000');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        state: 'CHARGE_ENTER_DESCRIPTION',
        data: expect.objectContaining({ amount: 5000 }),
      }),
    );
  });

  it('startChargeFlow: interactive shows amount buttons', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());

    await bot.handleMessage(FROM, '/cobrar');

    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Cuánto quieres cobrar'),
      expect.arrayContaining([expect.objectContaining({ id: 'amt_5000' })]),
    );
  });

  // ── /recibo command ─────────────────────────────────────

  it('/recibo with valid reference → shows transaction receipt', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockTransactions.getTransactionByReference.mockResolvedValue({
      direction: 'Enviado',
      amount: '$5.000 CLP',
      otherParty: 'Maria',
      date: '01/03/2026 12:00',
      status: 'COMPLETED',
      reference: '#WP-2026-AABB1122',
      fee: '$0 CLP',
    });

    await bot.handleMessage(FROM, '/recibo #WP-2026-AABB1122');

    expect(mockTransactions.getTransactionByReference).toHaveBeenCalledWith(
      '#WP-2026-AABB1122',
      USER_ID,
    );
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Comprobante'),
    );
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('#WP-2026-AABB1122'),
    );
  });

  it('/recibo with no reference → shows usage hint', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());

    await bot.handleMessage(FROM, '/recibo');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Uso:'),
    );
  });

  it('/recibo with unknown reference → shows not found message', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockTransactions.getTransactionByReference.mockResolvedValue(null);

    await bot.handleMessage(FROM, '/recibo #WP-UNKNOWN');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('no encontrada'),
    );
  });

  it('/recibo with "Recibido" direction → shows "De:" label', async () => {
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
    mockTransactions.getTransactionByReference.mockResolvedValue({
      direction: 'Recibido',
      amount: '$3.000 CLP',
      otherParty: 'Pedro',
      date: '02/03/2026 10:00',
      status: 'COMPLETED',
      reference: '#WP-2026-CCDD3344',
      fee: '$0 CLP',
    });

    await bot.handleMessage(FROM, '/recibo #WP-2026-CCDD3344');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('De: Pedro'),
    );
  });

  it('quick-pay: phone without 56 prefix → normalizes correctly', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // registered check
      .mockResolvedValueOnce(mkUser({ id: RECEIVER_ID, name: 'Maria', waId: '56987654321' })); // receiver
    mockWallets.getBalance.mockResolvedValue({ formatted: '$50.000 CLP', raw: 50000 });

    await bot.handleMessage(FROM, '/pagar 987654321 5000');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        state: 'PAY_CONFIRM',
        data: expect.objectContaining({
          receiverPhone: '56987654321',
        }),
      }),
    );
  });

  it('quick-pay: receiver with null name → uses formatPhone', async () => {
    mockUsers.getUserByWaId
      .mockResolvedValueOnce(mkUser()) // registered check
      .mockResolvedValueOnce(mkUser({ id: RECEIVER_ID, name: null, waId: '56987654321' })); // receiver
    mockWallets.getBalance.mockResolvedValue({ formatted: '$50.000 CLP', raw: 50000 });

    await bot.handleMessage(FROM, '/pagar 56987654321 5000');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({
        state: 'PAY_CONFIRM',
        data: expect.objectContaining({
          receiverName: expect.stringContaining('56'),
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════
//  REFUND FLOW (/devolver)
// ═══════════════════════════════════════════════════════

describe('refund flow', () => {
  let bot: BotService;

  beforeEach(() => {
    bot = new BotService();
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    mockUsers.getUserByWaId.mockResolvedValue(mkUser());
  });

  it('/devolver without ref shows usage', async () => {
    await bot.handleMessage(FROM, '/devolver');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Uso:'),
    );
  });

  it('/devolver with unknown ref shows not found', async () => {
    mockTransactions.getTransactionByReference.mockResolvedValue(null);

    await bot.handleMessage(FROM, '/devolver #WP-2026-NOTFOUND');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('no encontrada'),
    );
  });

  it('/devolver rejects sent payments (only received can be refunded)', async () => {
    mockTransactions.getTransactionByReference.mockResolvedValue({
      direction: 'Enviado',
      amount: '$5.000 CLP',
      otherParty: 'María',
      reference: '#WP-2026-REF1',
      status: 'COMPLETED',
    });

    await bot.handleMessage(FROM, '/devolver #WP-2026-REF1');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Solo puedes devolver pagos que hayas recibido'),
    );
  });

  it('/devolver rejects already reversed transactions', async () => {
    mockTransactions.getTransactionByReference.mockResolvedValue({
      direction: 'Recibido',
      amount: '$5.000 CLP',
      otherParty: 'Juan',
      reference: '#WP-2026-REF2',
      status: 'REVERSED',
    });

    await bot.handleMessage(FROM, '/devolver #WP-2026-REF2');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('ya fue devuelta'),
    );
  });

  it('/devolver with valid received tx shows confirmation buttons', async () => {
    mockTransactions.getTransactionByReference.mockResolvedValue({
      direction: 'Recibido',
      amount: '$5.000 CLP',
      otherParty: 'Juan',
      reference: '#WP-2026-REF3',
      status: 'COMPLETED',
    });

    await bot.handleMessage(FROM, '/devolver #WP-2026-REF3');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'REFUND_CONFIRM' }),
    );
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Devolver pago'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'confirm_refund' }),
      ]),
    );
  });

  it('REFUND_CONFIRM → confirm_refund → asks PIN', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_CONFIRM',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });

    await bot.handleMessage(FROM, 'confirm_refund', 'confirm_refund');

    expect(mockSetSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'REFUND_ENTER_PIN' }),
    );
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('PIN'));
  });

  it('REFUND_CONFIRM → cancel → deletes session', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_CONFIRM',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });

    await bot.handleMessage(FROM, 'algo');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, expect.stringContaining('cancelada'));
  });

  it('REFUND_ENTER_PIN → correct PIN → completes refund', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_ENTER_PIN',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });
    mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: 'OK' });
    mockTransactions.refundTransaction.mockResolvedValue({
      success: true,
      refundReference: '#WP-2026-REFUND01',
    });

    await bot.handleMessage(FROM, '123456');

    expect(mockTransactions.refundTransaction).toHaveBeenCalledWith('#WP-2026-REF3', USER_ID);
    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendButtonMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Devolución completada'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'cmd_balance' }),
      ]),
    );
  });

  it('REFUND_ENTER_PIN → wrong PIN → shows error', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_ENTER_PIN',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });
    mockUsers.verifyUserPin.mockResolvedValue({ success: false, message: 'PIN incorrecto' });

    await bot.handleMessage(FROM, '000000');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'PIN incorrecto');
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('REFUND_ENTER_PIN → locked account → deletes session', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_ENTER_PIN',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });
    mockUsers.verifyUserPin.mockResolvedValue({
      success: false,
      message: 'Cuenta bloqueada',
      isLocked: true,
    });

    await bot.handleMessage(FROM, '000000');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(FROM, 'Cuenta bloqueada');
  });

  it('REFUND_ENTER_PIN → refund fails without error message → shows default', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_ENTER_PIN',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });
    mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: 'OK' });
    mockTransactions.refundTransaction.mockResolvedValue({ success: false });

    await bot.handleMessage(FROM, '123456');

    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      'Error al procesar la devolución.',
    );
  });

  it('REFUND_ENTER_PIN → refund fails → shows error', async () => {
    mockGetSession.mockResolvedValue({
      userId: USER_ID,
      waId: FROM,
      state: 'REFUND_ENTER_PIN',
      data: { reference: '#WP-2026-REF3', amount: '$5.000 CLP', otherParty: 'Juan' },
      lastActivity: Date.now(),
    });
    mockUsers.verifyUserPin.mockResolvedValue({ success: true, message: 'OK' });
    mockTransactions.refundTransaction.mockResolvedValue({
      success: false,
      error: 'Solo puedes devolver pagos de las últimas 72 horas.',
    });

    await bot.handleMessage(FROM, '123456');

    expect(mockDeleteSession).toHaveBeenCalledWith(FROM);
    expect(mockWa.sendTextMessage).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('72 horas'),
    );
  });
});
