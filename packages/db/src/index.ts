import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index';

export type Database = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string, opts: { max?: number } = {}) {
  const client = postgres(databaseUrl, {
    max: opts.max ?? 10,
    onnotice: () => {},
  });
  // Set DRIZZLE_LOG=1 to trace every query (helpful when chasing UNDEFINED_VALUE).
  return drizzle(client, { schema, logger: process.env.DRIZZLE_LOG === '1' });
}

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL not set');
    _db = createDb(url);
  }
  return _db;
}

export * from './schema/index';
export * from './queries/commissions';
export { sql, eq, and, or, desc, asc, isNull, isNotNull, gt, gte, lt, lte, inArray, like, count, sum } from 'drizzle-orm';
