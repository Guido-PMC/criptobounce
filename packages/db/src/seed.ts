import { createDb } from './index';
import { platformCommissions, systemSettings, users } from './schema/index';
import { sql } from 'drizzle-orm';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  console.log('seeding system_settings...');
  await db
    .insert(systemSettings)
    .values([
      {
        key: 'maintenance_mode',
        value: { enabled: false },
      },
      {
        key: 'minimum_amounts',
        value: { USDT: 5, BTC: 0.0005, ETH: 0.01 },
      },
      {
        key: 'network_fees',
        value: {
          'USDT-TRC20': 1,
          'USDT-ERC20': 8,
          'USDT-BSC': 0.5,
          'USDT-POLYGON': 0.5,
          'USDT-ARBITRUM': 1,
          'USDT-SOL': 1,
          'BTC-BTC': 0.0005,
          'ETH-ERC20': 0.005,
        },
      },
      {
        key: 'asset_network_status',
        value: {},
      },
    ])
    .onConflictDoNothing();

  console.log('seeding platform_commissions...');
  await db
    .insert(platformCommissions)
    .values([
      { asset: '*', percent: '0.005', fixedAmount: '0.3' },
      { asset: 'USDT', percent: '0.005', fixedAmount: '0.3' },
      { asset: 'BTC', percent: '0.005', fixedAmount: '0' },
      { asset: 'ETH', percent: '0.005', fixedAmount: '0' },
    ])
    .onConflictDoNothing();

  const adminTgId = process.env.ADMIN_TELEGRAM_ID
    ? Number(process.env.ADMIN_TELEGRAM_ID)
    : undefined;
  const adminUsername = process.env.ADMIN_TELEGRAM_USERNAME;
  const adminEmail = process.env.ADMIN_GOOGLE_EMAIL;

  if (adminTgId) {
    console.log(`seeding admin user (telegram_id=${adminTgId})...`);
    await db
      .insert(users)
      .values({
        telegramId: adminTgId,
        telegramUsername: adminUsername,
        googleEmail: adminEmail,
        role: 'admin',
        status: 'approved',
        approvedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          role: 'admin',
          status: 'approved',
          telegramUsername: adminUsername ?? sql`${users.telegramUsername}`,
        },
      });
  } else {
    console.log('ADMIN_TELEGRAM_ID not set; skip admin seed');
  }

  console.log('seed done');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
