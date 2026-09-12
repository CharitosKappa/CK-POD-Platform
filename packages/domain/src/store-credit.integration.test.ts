import { randomUUID } from 'node:crypto';

import { createDatabaseClient } from '@let-it-be/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CustomerOperationsService } from './customer-operations';
import {
  StoreCreditConflictError,
  StoreCreditService,
  StoreCreditValidationError,
  type StoreCreditAdjustmentInput,
  type StoreCreditStaffActor,
} from './store-credit';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('Store Credit ledger integration', () => {
  const database = createDatabaseClient(process.env.DATABASE_URL!);
  const service = new StoreCreditService(database.pool);
  const customerOperations = new CustomerOperationsService(database.pool);
  const customerIds: string[] = [];
  let customerId: string;
  const actor: StoreCreditStaffActor = {
    staffMemberId: randomUUID(),
    email: `store-credit-${randomUUID()}@example.test`,
    role: 'OWNER',
  };
  const adjustment = (
    overrides: Partial<StoreCreditAdjustmentInput> = {},
  ): StoreCreditAdjustmentInput => ({
    direction: 'CREDIT',
    amount: '10.00',
    reason: 'REFUND',
    idempotencyKey: randomUUID(),
    ...overrides,
  });
  const balance = async () => {
    const result = await database.pool.query<{ current_balance_cents: number }>(
      'SELECT current_balance_cents FROM app.store_credit_accounts WHERE customer_profile_id=$1',
      [customerId],
    );
    return result.rows[0]?.current_balance_cents;
  };
  const ledger = async () =>
    database.pool.query<{
      entry_type: string;
      amount_cents: number;
      balance_after_cents: number;
      actor_staff_member_id: string;
      reason: string;
      note: string | null;
    }>(
      `SELECT l.* FROM app.store_credit_ledger l
     JOIN app.store_credit_accounts a ON a.id=l.store_credit_account_id
     WHERE a.customer_profile_id=$1 ORDER BY l.created_at, l.id`,
      [customerId],
    );

  beforeAll(async () => {
    await database.pool.query(
      `INSERT INTO app.staff_members (id,normalized_email,role,status) VALUES ($1,$2,'OWNER','ACTIVE')`,
      [actor.staffMemberId, actor.email],
    );
  });
  beforeEach(async () => {
    customerId = randomUUID();
    customerIds.push(customerId);
    await database.pool.query(
      `INSERT INTO app.customer_profiles (id,normalized_email,first_seen_source) VALUES ($1,$2,'CHECKOUT')`,
      [customerId, `store-credit-${customerId}@example.test`],
    );
  });
  afterAll(async () => {
    await database.pool.query('DELETE FROM app.customer_profiles WHERE id=ANY($1::uuid[])', [
      customerIds,
    ]);
    await database.pool.query('DELETE FROM app.staff_members WHERE id=$1', [actor.staffMemberId]);
    await database.close();
  });

  it('adds and deducts USD store credit while appending an auditable ledger', async () => {
    expect(await balance()).toBeUndefined();
    expect(await service.adjust(actor, customerId, adjustment())).toMatchObject({
      balanceCents: 1000,
      currency: 'USD',
      duplicate: false,
    });
    expect(
      await service.adjust(actor, customerId, adjustment({ direction: 'DEBIT', amount: '3.25' })),
    ).toMatchObject({ balanceCents: 675, duplicate: false });
    expect(await balance()).toBe(675);
    expect((await ledger()).rows).toMatchObject([
      { entry_type: 'CREDIT', amount_cents: 1000, balance_after_cents: 1000 },
      { entry_type: 'DEBIT', amount_cents: -325, balance_after_cents: 675 },
    ]);
    await service.adjust(actor, customerId, adjustment({ direction: 'DEBIT', amount: '6.75' }));
    expect(await balance()).toBe(0);
  });

  it('returns the original adjustment when an idempotency key is retried', async () => {
    const input = adjustment();
    const original = await service.adjust(actor, customerId, input);
    await service.adjust(actor, customerId, adjustment({ amount: '2.00' }));
    const duplicate = await service.adjust(actor, customerId, {
      ...input,
      direction: 'DEBIT',
      amount: '99.00',
    });
    expect(duplicate).toEqual({ ...original, duplicate: true });
    expect(await balance()).toBe(1200);
    expect((await ledger()).rows).toHaveLength(2);
  });

  it('serializes concurrent debits so the balance never becomes negative', async () => {
    await service.adjust(actor, customerId, adjustment());
    const results = await Promise.allSettled([
      service.adjust(actor, customerId, adjustment({ direction: 'DEBIT', amount: '7.00' })),
      service.adjust(actor, customerId, adjustment({ direction: 'DEBIT', amount: '7.00' })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBeInstanceOf(StoreCreditConflictError);
    expect(failures[0]?.reason.message).toBe('Store credit cannot be reduced below $0.00.');
    expect(await balance()).toBe(300);
    expect((await ledger()).rows.filter((row) => row.entry_type === 'DEBIT')).toHaveLength(1);
  });

  it('persists staff actor, reason, note, signed amount, and balance after', async () => {
    await service.adjust(
      actor,
      customerId,
      adjustment({
        amount: '12.34',
        reason: 'CUSTOMER_SERVICE',
        note: 'Replacement shipping courtesy',
      }),
    );
    expect((await ledger()).rows).toMatchObject([
      {
        actor_staff_member_id: actor.staffMemberId,
        reason: 'CUSTOMER_SERVICE',
        note: 'Replacement shipping courtesy',
        amount_cents: 1234,
        balance_after_cents: 1234,
      },
    ]);
  });

  it('projects a real adjustment into the customer detail balance and timeline', async () => {
    const addition = await service.adjust(
      actor,
      customerId,
      adjustment({
        amount: '12.50',
        reason: 'CUSTOMER_SERVICE',
        note: 'Replacement shipping courtesy',
      }),
    );
    const deduction = await service.adjust(
      actor,
      customerId,
      adjustment({
        direction: 'DEBIT',
        amount: '3.25',
        reason: 'OTHER',
        note: 'Courtesy amount correction',
      }),
    );

    const detail = await customerOperations.getCustomer(actor, customerId);

    expect(detail.storeCreditBalanceCents).toBe(925);
    expect(detail.storeCreditCurrency).toBe('USD');
    expect(detail.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `store-credit:${addition.entryId}`,
          eventType: 'STORE_CREDIT_ADJUSTMENT',
          actorLabel: actor.email,
          body: 'Replacement shipping courtesy',
          metadata: {
            amountCents: 1250,
            balanceAfterCents: 1250,
            direction: 'CREDIT',
            reason: 'CUSTOMER_SERVICE',
            currency: 'USD',
          },
        }),
        expect.objectContaining({
          id: `store-credit:${deduction.entryId}`,
          eventType: 'STORE_CREDIT_ADJUSTMENT',
          actorLabel: actor.email,
          body: 'Courtesy amount correction',
          metadata: {
            amountCents: -325,
            balanceAfterCents: 925,
            direction: 'DEBIT',
            reason: 'OTHER',
            currency: 'USD',
          },
        }),
      ]),
    );
  });

  it('applies simultaneous retries only once when lazily creating an account', async () => {
    const input = adjustment();
    const results = await Promise.all([
      service.adjust(actor, customerId, input),
      service.adjust(actor, customerId, input),
    ]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0]?.entryId).toBe(results[1]?.entryId);
    expect(await balance()).toBe(1000);
    expect((await ledger()).rows).toHaveLength(1);
  });

  it('rejects a missing customer without creating an account', async () => {
    const missingId = randomUUID();
    await expect(service.adjust(actor, missingId, adjustment())).rejects.toBeInstanceOf(
      StoreCreditValidationError,
    );
    const accounts = await database.pool.query(
      'SELECT id FROM app.store_credit_accounts WHERE customer_profile_id=$1',
      [missingId],
    );
    expect(accounts.rows).toHaveLength(0);
  });

  it('rolls back the balance if the audit ledger insert fails', async () => {
    await service.adjust(actor, customerId, adjustment());
    await expect(
      service.adjust({ ...actor, staffMemberId: randomUUID() }, customerId, adjustment()),
    ).rejects.toThrow();
    expect(await balance()).toBe(1000);
    expect((await ledger()).rows).toHaveLength(1);
  });
});
