import { z } from 'zod';

const commonSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const webSchema = commonSchema.extend({
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ADMIN_IP_ALLOWLIST: z.string().optional().default(''),
  WEB_INTERNAL_TOKEN: z.string().min(16),
  TELEGRAM_BOT_TOKEN: z.string().min(10).optional(),
});

const workerSchema = commonSchema.extend({
  MASTER_ENCRYPTION_KEY: z.string().min(32),
  MEX_HOST: z.string().url().default('https://api.mexc.com'),
  WORKER_ID: z.string().default(`worker-${Math.random().toString(36).slice(2, 8)}`),
  DEPOSIT_POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(30),
  BOUNCE_LOOP_INTERVAL_SEC: z.coerce.number().int().positive().default(5),
  RECONCILIATION_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
  SWEEP_CRON: z.string().default('0 3 * * *'),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  SLIPPAGE_MAX_PCT: z.coerce.number().positive().default(1),
  DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WEB_INTERNAL_TOKEN: z.string().min(16),
  WEB_INTERNAL_URL: z.string().url().default('http://localhost:3000'),
});

const botSchema = commonSchema.extend({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_ADMIN_CHAT_ID: z.coerce.number(),
  WEB_INTERNAL_TOKEN: z.string().min(16),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
});

export type WebEnv = z.infer<typeof webSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;
export type BotEnv = z.infer<typeof botSchema>;
export type CommonEnv = z.infer<typeof commonSchema>;

function fmtErr(prefix: string, err: z.ZodError): never {
  const issues = err.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`[${prefix}] env validation failed:\n${issues}`);
}

export function loadCommonEnv(env: NodeJS.ProcessEnv = process.env): CommonEnv {
  const parsed = commonSchema.safeParse(env);
  if (!parsed.success) fmtErr('common', parsed.error);
  return parsed.data;
}

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  const parsed = webSchema.safeParse(env);
  if (!parsed.success) fmtErr('web', parsed.error);
  return parsed.data;
}

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerSchema.safeParse(env);
  if (!parsed.success) fmtErr('worker', parsed.error);
  return parsed.data;
}

export function loadBotEnv(env: NodeJS.ProcessEnv = process.env): BotEnv {
  const parsed = botSchema.safeParse(env);
  if (!parsed.success) fmtErr('bot', parsed.error);
  return parsed.data;
}
