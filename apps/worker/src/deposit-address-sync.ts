import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@rb/db';
import type { WorkerEnv } from '@rb/config';
import { mexAccounts, mexDepositAddresses, users } from '@rb/db';
import { SUPPORTED_PAIRS } from '@rb/domain';
import type { MexCapitalConfigEntry } from '@rb/mex-client';
import { logger } from './logger';
import { runWithCorrelation, trace } from './correlation';
import { buildMexClient } from './mex-account';
import { resolveMexNetwork } from './lib/mex-network-resolver';

/** Refresh addresses every 24h. They are static in practice but we re-check in case MEXC rotates. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** How often the loop wakes up to look for work. */
const POLL_MS = 60_000;

interface Ctx {
  db: Database;
  env: WorkerEnv;
}

export function startDepositAddressSync({ db, env }: Ctx): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await syncOnce(db, env);
    } catch (err) {
      logger.error({ err }, 'deposit-address-sync iteration failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };
  // Initial delay slightly offset from balance-sync so we don't burst MEX at boot.
  timer = setTimeout(tick, 12_000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function syncOnce(db: Database, env: WorkerEnv) {
  const accounts = await db
    .select({
      id: mexAccounts.id,
      userId: mexAccounts.userId,
      mexEmail: mexAccounts.mexEmail,
      apiKeyEnc: mexAccounts.apiKeyEnc,
      apiSecretEnc: mexAccounts.apiSecretEnc,
      ipWhitelisted: mexAccounts.ipWhitelisted,
      status: mexAccounts.status,
      lastBalanceSync: mexAccounts.lastBalanceSync,
      balanceCache: mexAccounts.balanceCache,
      createdAt: mexAccounts.createdAt,
      updatedAt: mexAccounts.updatedAt,
    })
    .from(mexAccounts)
    .innerJoin(users, eq(users.id, mexAccounts.userId))
    .where(and(eq(mexAccounts.status, 'active'), isNull(users.deletedAt)));

  if (accounts.length === 0) return;

  await runWithCorrelation(
    db,
    {
      type: 'deposit_address_sync',
      summary: `deposit address sync (${accounts.length} accounts × ${SUPPORTED_PAIRS.length} pairs)`,
    },
    async () => {
      for (const mex of accounts) {
        let client;
        try {
          client = buildMexClient(db, env, mex);
        } catch (err) {
          await trace(db, 'warn', 'build_client_failed', `account ${mex.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        let capital: MexCapitalConfigEntry[] = [];
        try {
          capital = await client.getCapitalConfig();
        } catch (err) {
          await trace(db, 'warn', 'capital_config_failed', `account ${mex.id}`, {
            mexAccountId: mex.id,
            error: err instanceof Error ? err.message : String(err),
          });
          logger.warn(
            { err, mexAccountId: mex.id },
            'getCapitalConfig failed; cannot sync deposit addresses this iteration',
          );
          continue;
        }

        for (const pair of SUPPORTED_PAIRS) {
          try {
            const resolved = resolveMexNetwork(pair.asset, pair.network, capital);
            if (!resolved) {
              await trace(db, 'warn', 'pair_unsupported_at_mex', `${pair.asset}/${pair.network}`, {
                mexAccountId: mex.id,
                pair,
              });
              await markError(
                db,
                mex.id,
                pair.asset,
                pair.network,
                `MEX no expone esta combinacion (${pair.asset}/${pair.network}) en /capital/config/getall`,
              );
              continue;
            }
            await syncPair(db, client, mex.id, pair.asset, pair.network, resolved, env.DRY_RUN);
          } catch (err) {
            await trace(db, 'warn', 'pair_sync_failed', `${pair.asset}/${pair.network}`, {
              mexAccountId: mex.id,
              pair,
              error: err instanceof Error ? err.message : String(err),
            });
            logger.warn(
              { err, mexAccountId: mex.id, coin: pair.asset, network: pair.network },
              'deposit address sync failed for pair',
            );
            await markError(db, mex.id, pair.asset, pair.network, errorMessage(err));
          }
        }
      }
    },
  );
}

async function syncPair(
  db: Database,
  client: ReturnType<typeof buildMexClient>,
  mexAccountId: string,
  coin: string,
  network: string,
  mex: { coin: string; network: string },
  dryRun: boolean,
) {
  const existing = await db.query.mexDepositAddresses.findFirst({
    where: and(
      eq(mexDepositAddresses.mexAccountId, mexAccountId),
      eq(mexDepositAddresses.coin, coin),
      eq(mexDepositAddresses.network, network),
    ),
  });

  // Skip if we already have a healthy address that was refreshed recently.
  if (existing?.status === 'ok' && existing.address && existing.fetchedAt) {
    const ageMs = Date.now() - existing.fetchedAt.getTime();
    if (ageMs < REFRESH_AFTER_MS) return;
  }

  const got = await client.getDepositAddress({ coin: mex.coin, network: mex.network });

  if (got?.address) {
    await upsertAddress(db, {
      mexAccountId,
      coin,
      network,
      status: 'ok',
      address: got.address,
      memo: got.memo ?? null,
      lastError: null,
    });
    return;
  }

  // No address yet on MEX — try to generate one.
  if (dryRun) {
    // POST is short-circuited in dryRun: just record pending so the UI can show it.
    await upsertAddress(db, {
      mexAccountId,
      coin,
      network,
      status: 'pending',
      address: null,
      memo: null,
      lastError: 'dry-run: address generation skipped',
    });
    return;
  }

  await upsertAddress(db, {
    mexAccountId,
    coin,
    network,
    status: 'generating',
    address: null,
    memo: null,
    lastError: null,
  });

  const generated = await client.generateDepositAddress({ coin: mex.coin, network: mex.network });
  if (generated.address) {
    await upsertAddress(db, {
      mexAccountId,
      coin,
      network,
      status: 'ok',
      address: generated.address,
      memo: generated.memo,
      lastError: null,
    });
    return;
  }

  // POST didn't return an address synchronously; try one more GET — MEXC sometimes
  // returns the address only on the subsequent fetch.
  const retry = await client.getDepositAddress({ coin: mex.coin, network: mex.network });
  if (retry?.address) {
    await upsertAddress(db, {
      mexAccountId,
      coin,
      network,
      status: 'ok',
      address: retry.address,
      memo: retry.memo ?? null,
      lastError: null,
    });
    return;
  }

  await upsertAddress(db, {
    mexAccountId,
    coin,
    network,
    status: 'pending',
    address: null,
    memo: null,
    lastError: 'MEX did not return an address after generation',
  });
}

interface UpsertArgs {
  mexAccountId: string;
  coin: string;
  network: string;
  status: 'ok' | 'pending' | 'generating' | 'error';
  address: string | null;
  memo: string | null;
  lastError: string | null;
}

async function upsertAddress(db: Database, a: UpsertArgs) {
  const now = new Date();
  await db
    .insert(mexDepositAddresses)
    .values({
      mexAccountId: a.mexAccountId,
      coin: a.coin,
      network: a.network,
      status: a.status,
      address: a.address,
      memo: a.memo,
      lastError: a.lastError,
      fetchedAt: a.status === 'ok' ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        mexDepositAddresses.mexAccountId,
        mexDepositAddresses.coin,
        mexDepositAddresses.network,
      ],
      set: {
        status: a.status,
        address: a.address,
        memo: a.memo,
        lastError: a.lastError,
        fetchedAt: a.status === 'ok' ? now : sql`coalesce(${mexDepositAddresses.fetchedAt}, NULL)`,
        updatedAt: now,
      },
    });
}

async function markError(
  db: Database,
  mexAccountId: string,
  coin: string,
  network: string,
  message: string,
) {
  const now = new Date();
  await db
    .insert(mexDepositAddresses)
    .values({
      mexAccountId,
      coin,
      network,
      status: 'error',
      lastError: message,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        mexDepositAddresses.mexAccountId,
        mexDepositAddresses.coin,
        mexDepositAddresses.network,
      ],
      set: {
        // If we had a working address before, keep it but flag the error so the UI shows the warning.
        status: sql`CASE WHEN ${mexDepositAddresses.status} = 'ok' THEN 'ok' ELSE 'error' END`,
        lastError: message,
        updatedAt: now,
      },
    });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
