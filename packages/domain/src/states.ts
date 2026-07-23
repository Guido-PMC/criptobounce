export const USER_STATUSES = ['pending', 'approved', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DEPOSIT_STATUSES = [
  'detected',
  'confirmed',
  'queued',
  'processing',
  'bounced',
  'failed',
  'on_hold',
  'below_minimum',
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const BOUNCE_JOB_STATES = [
  'pending',
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'awaiting_withdrawal',
  'done',
  'failed',
  'on_hold',
] as const;
export type BounceJobState = (typeof BOUNCE_JOB_STATES)[number];

export const WITHDRAWAL_STATUSES = [
  'pending',
  'submitted',
  'processing',
  'success',
  'failed',
  'cancelled',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_TYPES = [
  'user_payout',
  'platform_sweep',
  'manual_sweep',
  'manual_operation_payout',
  'manual_operation_refund',
] as const;
export type WithdrawalType = (typeof WITHDRAWAL_TYPES)[number];

export const MANUAL_OPERATION_STATES = [
  'awaiting_deposit',
  'awaiting_deposit_confirmation',
  'pending_user_confirm',
  'pending_admin_confirm',
  'pending_candidate_resolution',
  'converting',
  'awaiting_conversion',
  'withdrawing',
  'awaiting_withdrawal',
  'refunding',
  'awaiting_refund',
  'on_hold',
  'done',
  'failed',
  'expired',
  'cancelled',
] as const;
export type ManualOperationState = (typeof MANUAL_OPERATION_STATES)[number];

export const SWEEP_RUN_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type SweepRunStatus = (typeof SWEEP_RUN_STATUSES)[number];

export const OPERATION_STATUSES = ['running', 'succeeded', 'failed', 'on_hold'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const OPERATION_TYPES = [
  'deposit_bounce',
  'sweep',
  'admin_action',
  'telegram_command',
  'user_action',
  'reconciliation',
  'manual_sweep',
  'manual_operation',
  'balance_sync',
  'deposit_address_sync',
  'deposit_poll',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const TRACE_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type TraceLevel = (typeof TRACE_LEVELS)[number];

export const MEX_ACCOUNT_STATUSES = ['active', 'disabled', 'rotating'] as const;
export type MexAccountStatus = (typeof MEX_ACCOUNT_STATUSES)[number];
