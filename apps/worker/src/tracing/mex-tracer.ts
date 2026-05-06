import type { Database } from '@rb/db';
import { mexApiCalls } from '@rb/db';
import type { MexTracer, MexCallRecord } from '@rb/mex-client';
import { currentCorrelationId } from '../correlation';

/**
 * Endpoints whose successful response is huge and predictable (~100KB+).
 * We still persist errors for these, just not the success bodies.
 */
const NOISY_ENDPOINTS = new Set<string>(['/api/v3/capital/config/getall']);

export function createMexTracer(db: Database): MexTracer {
  return {
    shouldLog({ endpoint, status }) {
      // Opt OUT successful calls to noisy endpoints. Errors (status >= 400) still log.
      if (NOISY_ENDPOINTS.has(endpoint) && status !== undefined && status < 400) {
        return false;
      }
      return true;
    },
    async logCall(record: MexCallRecord) {
      const operationId = currentCorrelationId() ?? null;
      await db.insert(mexApiCalls).values({
        operationId,
        method: record.method,
        endpoint: record.endpoint,
        requestParams: (record.requestParams as object) ?? {},
        responseStatus: record.responseStatus ?? null,
        responseBody: (record.responseBody as object) ?? null,
        responseMs: record.responseMs,
        error: record.error ?? null,
        withdrawOrderId: record.withdrawOrderId ?? null,
      });
    },
  };
}
