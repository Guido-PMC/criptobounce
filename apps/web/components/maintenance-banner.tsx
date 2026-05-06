import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { systemSettings, type MaintenanceModeValue } from '@rb/db';

export async function MaintenanceBanner() {
  try {
    const row = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'maintenance_mode'),
    });
    const v = row?.value as MaintenanceModeValue | undefined;
    if (!v?.enabled) return null;

    return (
      <div className="bg-yellow-100 border-b border-yellow-300 text-yellow-900 px-4 py-2 text-sm text-center">
        <strong>Mantenimiento en curso.</strong> Los reenvios estan pausados temporalmente. Tus
        fondos estan seguros.
        {v.reason ? <span className="ml-2 italic">({v.reason})</span> : null}
      </div>
    );
  } catch {
    return null;
  }
}
