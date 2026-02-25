import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // WhatsApp Business API
  WHATSAPP_API_URL: z.string().url().default('https://graph.facebook.com/v18.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string(),
  WHATSAPP_API_TOKEN: z.string(),
  WHATSAPP_VERIFY_TOKEN: z.string(),

  // Transbank
  TRANSBANK_COMMERCE_CODE: z.string(),
  TRANSBANK_API_KEY: z.string(),
  TRANSBANK_ENVIRONMENT: z.enum(['integration', 'production']).default('integration'),

  // Khipu
  KHIPU_RECEIVER_ID: z.string(),
  KHIPU_SECRET: z.string(),

  // Security
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRATION: z.string().default('30m'),
  ENCRYPTION_KEY_ID: z.string(), // Cloud KMS key ID

  // Google Cloud
  GCP_PROJECT_ID: z.string(),
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

  return result.data;
}

export const env = loadEnvironment();
