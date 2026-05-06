import { eq } from 'drizzle-orm';
import type { Database } from '@rb/db';
import { systemSettings, type MaintenanceModeValue } from '@rb/db';

const TTL_MS = 5_000;
let cache: { at: number; enabled: boolean; reason?: string } | null = null;

export async function isMaintenanceActive(db: Database): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.enabled;
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, 'maintenance_mode'),
  });
  const v = (row?.value as MaintenanceModeValue | undefined) ?? { enabled: false };
  cache = { at: Date.now(), enabled: Boolean(v.enabled), reason: v.reason };
  return cache.enabled;
}

export function invalidateMaintenanceCache() {
  cache = null;
}
