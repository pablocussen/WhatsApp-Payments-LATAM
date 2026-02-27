import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // WhatsApp Business API
  WHATSAPP_API_URL: z.string().url().default('https://graph.facebook.com/v18.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default('not-configured'),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default('not-configured'),
  WHATSAPP_API_TOKEN: z.string().default('not-configured'),
  WHATSAPP_APP_SECRET: z.string().optional(), // Used to validate X-Hub-Signature-256
  WHATSAPP_VERIFY_TOKEN: z.string().default('whatpay-verify-2026'),

  // Transbank
  TRANSBANK_COMMERCE_CODE: z.string().default('597055555532'),
  TRANSBANK_API_KEY: z
    .string()
    .default('579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C'),
  TRANSBANK_ENVIRONMENT: z.enum(['integration', 'production']).default('integration'),

  // Khipu
  KHIPU_RECEIVER_ID: z.string().default('not-configured'),
  KHIPU_SECRET: z.string().default('not-configured'),

  // Security
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRATION: z.string().default('30m'),
  ENCRYPTION_KEY_ID: z.string().default('local'),
  ENCRYPTION_KEY_HEX: z.string().length(64).optional(), // Required in production

  // Google Cloud
  GCP_PROJECT_ID: z.string().default('whatpay-cl'),
  GCP_REGION: z.string().default('southamerica-west1'),
  PUBSUB_PAYMENT_TOPIC: z.string().default('payment-events'),

  // Cloud AI
  FRAUD_MODEL_ENDPOINT: z.string().url().optional(),

  // App
  APP_BASE_URL: z.string().url().default('https://whatpay.cl'),
  PAYMENT_LINK_BASE_URL: z.string().url().default('https://whatpay.cl/c'),
});

export type Environment = z.infer<typeof envSchema>;

export function loadEnvironment(): Environment {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }

  if (result.data.NODE_ENV === 'production') {
    if (!result.data.ENCRYPTION_KEY_HEX) {
      console.error('[SECURITY] ENCRYPTION_KEY_HEX is required in production');
      process.exit(1);
    }
    if (!result.data.WHATSAPP_APP_SECRET) {
      console.warn(
        '[SECURITY] WHATSAPP_APP_SECRET not set — webhook signature verification disabled',
      );
    }
  }

  return result.data;
}

export const env = loadEnvironment();
