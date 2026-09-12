import { withTransaction, type SqlPool } from '@let-it-be/db';

import type { StaffRole } from './staff-identity';

export const storeCreditReasons = ['REFUND', 'PROMOTION', 'CUSTOMER_SERVICE', 'OTHER'] as const;

export type StoreCreditReason = (typeof storeCreditReasons)[number];
export type StoreCreditDirection = 'CREDIT' | 'DEBIT';

export interface StoreCreditStaffActor {
  staffMemberId: string;
  email: string;
  role: StaffRole;
}

export interface StoreCreditAdjustmentInput {
  direction: StoreCreditDirection;
  amount: string;
  reason: StoreCreditReason;
  note?: string;
  idempotencyKey: string;
}

export interface StoreCreditAdjustmentResult {
  entryId: string;
  balanceCents: number;
  currency: 'USD';
  duplicate: boolean;
}

export class StoreCreditAccessError extends Error {}
export class StoreCreditValidationError extends Error {}
export class StoreCreditConflictError extends Error {}

export function parseUsdCents(value: string): number {
  if (typeof value !== 'string') throw new StoreCreditValidationError('Enter a valid USD amount.');
  const match = /^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new StoreCreditValidationError('Enter a valid USD amount.');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (cents < 1 || cents > 10_000_000)
    throw new StoreCreditValidationError('Enter an amount between $0.01 and $100,000.00.');
  return cents;
}

interface AdjustmentRow {
  id: string;
  balance_after_cents: number;
}

function mapAdjustment(row: AdjustmentRow, duplicate: boolean): StoreCreditAdjustmentResult {
  return { entryId: row.id, balanceCents: row.balance_after_cents, currency: 'USD', duplicate };
}

/** Monetary USD adjustments are serialized per customer and recorded atomically in the ledger. */
export class StoreCreditService {
  constructor(private readonly pool: SqlPool) {}

  async adjust(
    actor: StoreCreditStaffActor,
    customerId: string,
    input: StoreCreditAdjustmentInput,
  ): Promise<StoreCreditAdjustmentResult> {
    if (actor.role !== 'OWNER' && actor.role !== 'OPERATIONS')
      throw new StoreCreditAccessError('You do not have permission to adjust store credit.');
    if (
      typeof customerId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)
    )
      throw new StoreCreditValidationError('Choose a valid customer.');
    if (input.direction !== 'CREDIT' && input.direction !== 'DEBIT')
      throw new StoreCreditValidationError('Choose a valid store credit direction.');
    if (!storeCreditReasons.includes(input.reason))
      throw new StoreCreditValidationError('Choose a supported store credit reason.');
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000))
      throw new StoreCreditValidationError('The internal note must be 1000 characters or fewer.');
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.trim().length < 12 ||
      input.idempotencyKey.length > 120
    )
      throw new StoreCreditValidationError(
        'Provide an idempotency key between 12 and 120 characters.',
      );
    const { direction, reason, note, idempotencyKey } = input;
    const amountCents = parseUsdCents(input.amount);

    return withTransaction(this.pool, async (client) => {
      const customer = await client.query<{ id: string }>(
        'SELECT id FROM app.customer_profiles WHERE id=$1',
        [customerId],
      );
      if (!customer.rows[0]) throw new StoreCreditValidationError('Customer not found.');

      await client.query(
        `INSERT INTO app.store_credit_accounts (customer_profile_id)
         VALUES ($1) ON CONFLICT (customer_profile_id) DO NOTHING`,
        [customerId],
      );
      const locked = await client.query<{ id: string; current_balance_cents: number }>(
        `SELECT id, current_balance_cents FROM app.store_credit_accounts
         WHERE customer_profile_id=$1 FOR UPDATE`,
        [customerId],
      );
      const account = locked.rows[0];
      if (!account) throw new StoreCreditConflictError('Could not locate store credit account.');

      // Check after the account lock so concurrent requests observe the committed original entry.
      const existing = await client.query<AdjustmentRow>(
        `SELECT id, balance_after_cents FROM app.store_credit_ledger
         WHERE store_credit_account_id=$1 AND idempotency_key=$2`,
        [account.id, idempotencyKey],
      );
      if (existing.rows[0]) return mapAdjustment(existing.rows[0], true);

      const delta = direction === 'CREDIT' ? amountCents : -amountCents;
      const balanceCents = account.current_balance_cents + delta;
      if (balanceCents < 0)
        throw new StoreCreditConflictError('Store credit cannot be reduced below $0.00.');

      await client.query(
        `UPDATE app.store_credit_accounts SET current_balance_cents=$2, updated_at=now()
         WHERE id=$1`,
        [account.id, balanceCents],
      );
      const inserted = await client.query<AdjustmentRow>(
        `INSERT INTO app.store_credit_ledger (
           store_credit_account_id, entry_type, amount_cents, balance_after_cents,
           reason, note, actor_staff_member_id, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, balance_after_cents`,
        [
          account.id,
          direction,
          delta,
          balanceCents,
          reason,
          note ?? null,
          actor.staffMemberId,
          idempotencyKey,
        ],
      );
      const entry = inserted.rows[0];
      if (!entry) throw new StoreCreditConflictError('Could not record store credit adjustment.');
      return mapAdjustment(entry, false);
    });
  }
}
