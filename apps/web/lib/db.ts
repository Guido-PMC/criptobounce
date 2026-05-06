import { createDb, type Database } from '@rb/db';

const globalForDb = globalThis as unknown as { __rbDb?: Database };

export const db: Database =
  globalForDb.__rbDb ??
  (globalForDb.__rbDb = createDb(process.env.DATABASE_URL ?? '', { max: 5 }));
