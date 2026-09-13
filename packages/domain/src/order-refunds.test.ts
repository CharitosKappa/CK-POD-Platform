import type { SqlPool } from '@let-it-be/db';
import { describe, expect, it } from 'vitest';

import * as domain from './index';
import { FakePaymentService } from './payments';

const databaseReached = new Error('Database boundary reached');
const pool: SqlPool = {
  async query() {
    throw databaseReached;
  },
  async connect() {
    throw databaseReached;
  },
};
const staff = {
  type: 'STAFF' as const,
  staffMemberId: '20000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: 'OWNER' as const,
};
const input = {
  orderNumber: '#1',
  amountCents: 1200,
  reasonCode: 'CUSTOMER_REQUEST',
  note: 'Approved by support',
  idempotencyKey: 'refund-store-credit-0001',
};
function service() {
  expect(domain.OrderRefundService).toBeTypeOf('function');
  return new domain.OrderRefundService(pool, new FakePaymentService());
}

describe('shared refund preflight', () => {
  // Staff form bounds must not invalidate existing CX keys or stored free-form notes.
  it.each([
    { label: 'short key', legacy: { idempotencyKey: 'old-key' } },
    { label: 'long note', legacy: { note: 'x'.repeat(1001) } },
  ])('preserves legacy USER refund $label', async ({ legacy }) => {
    await expect(
      service().refundOriginalPayment(
        { type: 'USER', userId: staff.staffMemberId, email: staff.email },
        { ...input, ...legacy },
      ),
    ).rejects.toBe(databaseReached);
  });

  // Removing integer validation would send fractional or non-finite money to persistence.
  it.each([0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid minor-unit amount %s before database access',
    async (amountCents) => {
      await expect(
        service().refundOriginalPayment(staff, { ...input, amountCents }),
      ).rejects.toThrow('A positive integer refund amount is required.');
    },
  );

  // A role guard regression would allow prepress/read-only staff to issue money.
  it.each(['PREPRESS', 'READ_ONLY'] as const)('rejects %s actors', async (role) => {
    const refunds = service();
    for (const method of ['refundOriginalPayment', 'refundToStoreCredit'] as const) {
      await expect(refunds[method]({ ...staff, role } as never, input)).rejects.toThrow(
        'Operations access is restricted.',
      );
    }
  });

  // The staff-only ledger must never invent a staff identity for a USER actor.
  it('rejects USER Store Credit before opening a transaction', async () => {
    await expect(
      service().refundToStoreCredit(
        { type: 'USER', userId: staff.staffMemberId, email: staff.email },
        input,
      ),
    ).rejects.toThrow('Store Credit refunds require a staff actor.');
  });

  // Missing input bounds otherwise permit unbounded notes and unusable operation keys.
  it('validates order, reason, note, and idempotency key', async () => {
    const refunds = service();
    for (const invalid of [
      { orderNumber: '' },
      { reasonCode: 'UNKNOWN' },
      { note: 'x'.repeat(1001) },
      { idempotencyKey: 'short' },
      { idempotencyKey: ' '.repeat(12) },
      { idempotencyKey: 'x'.repeat(121) },
    ]) {
      await expect(refunds.refundToStoreCredit(staff, { ...input, ...invalid })).rejects.not.toBe(
        databaseReached,
      );
    }
  });

  // Permitted staff must reach the actual monetary transaction for both destinations.
  it.each(['OWNER', 'OPERATIONS'] as const)('admits %s staff', async (role) => {
    const refunds = service();
    for (const method of ['refundOriginalPayment', 'refundToStoreCredit'] as const) {
      await expect(refunds[method]({ ...staff, role }, input)).rejects.toBe(databaseReached);
    }
  });
});
