/**
 * Deterministic withdrawOrderId for user payouts.
 * Same bounce_job_id always produces same id, allowing safe retries.
 * MEX dedupes server-side by withdrawOrderId.
 */
export function userPayoutOrderId(bounceJobId: string): string {
  return `rb-${bounceJobId.replace(/-/g, '').slice(0, 28)}`;
}

export function platformSweepOrderId(sweepRunId: string, mexAccountId: string): string {
  const s = sweepRunId.replace(/-/g, '').slice(0, 12);
  const a = mexAccountId.replace(/-/g, '').slice(0, 12);
  return `sw-${s}-${a}`;
}

export function manualSweepOrderId(actionId: string): string {
  return `ms-${actionId.replace(/-/g, '').slice(0, 28)}`;
}

export function conversionClientOrderId(bounceJobId: string): string {
  return `rb-conv-${bounceJobId.replace(/-/g, '').slice(0, 22)}`;
}
