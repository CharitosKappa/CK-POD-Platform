import type { StoreCreditDirection, StoreCreditReason } from '@let-it-be/domain';

import { createClientIdempotencyKey } from '../../../../lib/client-id';

export interface StoreCreditAdjustmentDraft {
  direction: StoreCreditDirection;
  amount: string;
  reason: StoreCreditReason | '';
  note: string;
}

export function storeCreditAmountCents(value: string): number | null {
  const match = /^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents >= 1 && cents <= 10_000_000 ? cents : null;
}

export function storeCreditAdjustmentErrors(draft: StoreCreditAdjustmentDraft) {
  const errors: Partial<Record<'amount' | 'reason' | 'note', string>> = {};
  if (storeCreditAmountCents(draft.amount) === null)
    errors.amount = 'Enter an amount between $0.01 and $100,000.00, with up to two decimal places.';
  if (!['REFUND', 'PROMOTION', 'CUSTOMER_SERVICE', 'OTHER'].includes(draft.reason))
    errors.reason = 'Choose a reason.';
  if (draft.note.trim().length > 1000)
    errors.note = 'The internal note must be 1000 characters or fewer.';
  return errors;
}

export function storeCreditAdjustmentPayload(
  draft: StoreCreditAdjustmentDraft,
  idempotencyKey: string,
) {
  return {
    direction: draft.direction,
    amount: draft.amount.trim(),
    reason: draft.reason,
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    idempotencyKey,
  };
}

export interface StoreCreditSubmitIntent {
  signature: string;
  idempotencyKey: string;
}

export function storeCreditSubmitIntent(
  draft: StoreCreditAdjustmentDraft,
  previous?: StoreCreditSubmitIntent,
): StoreCreditSubmitIntent {
  const signature = JSON.stringify(draft);
  if (previous?.signature === signature) return previous;
  return { signature, idempotencyKey: createClientIdempotencyKey() };
}
