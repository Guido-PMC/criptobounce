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

function manualOperationId(prefix: 'mc' | 'mp' | 'mr', operationId: string, attempt = 0): string {
  const suffix = attempt > 0 ? `-r${attempt}` : '';
  const compact = operationId.replace(/-/g, '');
  return `${prefix}-${compact.slice(0, 29 - suffix.length)}${suffix}`;
}

export function manualOperationConversionOrderId(operationId: string): string {
  return manualOperationId('mc', operationId);
}

export function manualOperationPayoutOrderId(operationId: string, attempt = 0): string {
  return manualOperationId('mp', operationId, attempt);
}

export function manualOperationRefundOrderId(operationId: string, attempt = 0): string {
  return manualOperationId('mr', operationId, attempt);
}
