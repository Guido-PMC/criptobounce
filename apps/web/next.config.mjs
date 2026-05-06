import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load monorepo root .env first, then any local .env (which may be a symlink to root).
loadDotenv({ path: resolve(__dirname, '../../.env') });
loadDotenv({ path: resolve(__dirname, '.env'), override: false });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rb/db', '@rb/mex-client', '@rb/crypto', '@rb/domain', '@rb/config'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  serverExternalPackages: ['postgres'],
  env: {
    // Re-expose to the runtime env that Next.js bundles (so middleware + edge picks it up too).
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY,
    WEB_INTERNAL_TOKEN: process.env.WEB_INTERNAL_TOKEN,
    ADMIN_IP_ALLOWLIST: process.env.ADMIN_IP_ALLOWLIST ?? '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID,
    DRY_RUN: process.env.DRY_RUN ?? 'false',
  },
};

export default nextConfig;
