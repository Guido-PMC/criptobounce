import type { Database } from '@rb/db';
import { telegramMessages, users } from '@rb/db';
import { eq } from 'drizzle-orm';
import { currentCorrelationId } from './correlation';

type TemplateKey =
  | 'deposit_detected'
  | 'deposit_confirmed'
  | 'bounce_done'
  | 'bounce_failed'
  | 'bounce_on_hold'
  | 'below_minimum'
  | 'admin_alert'
  | 'manual_op_deposit_detected'
  | 'manual_op_deposit_exact'
  | 'manual_op_deposit_mismatch'
  | 'manual_op_processing'
  | 'manual_op_done'
  | 'manual_op_on_hold'
  | 'manual_op_expired'
  | 'manual_op_cancelled'
  | 'manual_op_candidate_resolution';

interface NotifyOpts {
  type: TemplateKey;
  userId?: string;
  chatId?: string;
  text: string;
  dedupeKey?: string;
}

export async function notify(db: Database, opts: NotifyOpts): Promise<void> {
  let chatId = opts.chatId;
  if (!chatId && opts.userId) {
    const u = await db.query.users.findFirst({ where: eq(users.id, opts.userId) });
    if (u?.telegramId) chatId = String(u.telegramId);
  }
  if (!chatId) return;
  await db
    .insert(telegramMessages)
    .values({
      operationId: currentCorrelationId() ?? null,
      userId: opts.userId ?? null,
      chatId,
      direction: 'out',
      type: opts.type,
      rawPayload: { text: opts.text },
      sentOk: null,
      dedupeKey: opts.dedupeKey,
    })
    .onConflictDoNothing();
}

export const tpl = {
  depositDetected: (asset: string, network: string, amount: string) =>
    `Detectamos un deposito de ${amount} ${asset} en ${network}. Esperando confirmaciones...`,
  depositConfirmed: (asset: string, network: string, amount: string) =>
    `Tu deposito de ${amount} ${asset} en ${network} esta confirmado. Procesando reenvio.`,
  bounceDone: (amount: string, asset: string, network: string, tx: string) =>
    `Reenvio completado: ${amount} ${asset} enviados via ${network}. Tx: ${tx}`,
  bounceFailed: (asset: string, reason: string) =>
    `No pudimos completar el reenvio de ${asset}. Motivo: ${reason}. Tus fondos siguen en tu cuenta.`,
  bounceOnHold: (asset: string, reason: string) =>
    `Tu reenvio de ${asset} quedo en revision: ${reason}. El admin esta avisado.`,
  belowMinimum: (asset: string, amount: string, min: number) =>
    `El deposito de ${amount} ${asset} no alcanza el minimo (${min}). Queda pendiente hasta que sumes mas.`,
  manualDepositDetected: () =>
    'Detectamos tu deposito dentro del plazo. Esperando confirmaciones de red/MEX.',
  manualDepositExact: (amount: string, asset: string) =>
    `Recibimos ${amount} ${asset}. Confirma la operacion en el panel.`,
  manualDepositMismatch: (amount: string, expected: string, asset: string, operationId: string) =>
    `Deposito ${amount} ${asset} para operacion ${operationId} (esperado ${expected}). Requiere revision.`,
  manualProcessing: () => 'Operacion confirmada, procesando...',
  manualDone: (amount: string, asset: string) =>
    `Operacion completada: ${amount} ${asset} enviados a tu wallet.`,
  manualOnHold: (reason: string) =>
    `La operacion requiere revision: ${reason}. Tus fondos permanecen identificados en MEX.`,
  manualExpired: () => 'Operacion expirada. Contacta al admin si necesitas una nueva.',
  manualCancelled: () => 'Operacion cancelada por el administrador.',
  manualCandidateResolution: () =>
    'El pago principal termino, pero hay depositos adicionales pendientes de resolucion.',
};
