import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs in the package cwd (packages/db) where there is no .env;
// load the workspace-root one so `pnpm db:migrate` works without exporting
// DATABASE_URL manually each time.
loadDotEnv({ path: resolve(process.cwd(), '../../.env') });
loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run drizzle-kit');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
