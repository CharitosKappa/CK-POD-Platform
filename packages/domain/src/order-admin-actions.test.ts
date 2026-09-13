import type { SqlPool } from '@let-it-be/db';
import { describe, expect, it } from 'vitest';

import * as domain from './index';
import type { AdminStaffSession } from './admin-commerce';

// Validation must reject bad requests before they can acquire locks or write audits.
const databaseReached = new Error('Database boundary reached');
const pool: SqlPool = {
  async query() {
    throw databaseReached;
  },
  async connect() {
    throw databaseReached;
  },
};
const staff: AdminStaffSession = {
  id: 'session',
  staffMemberId: '20000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS',
  email: 'operations@example.test',
  expiresAt: new Date('2099-01-01'),
};
const input = {
  orderNumber: '#1',
  reasonCode: 'ORDER_COMPLETE',
  note: 'Completed order',
  idempotencyKey: 'archive-order-0001',
};

function service() {
  expect(domain.OrderAdminActionsService).toBeTypeOf('function');
  return new domain.OrderAdminActionsService(pool);
}

describe('order archive action preflight', () => {
  it.each(['archive', 'unarchive'] as const)(
    '%s restricts mutation to OWNER/OPERATIONS',
    async (method) => {
      const actions = service();
      for (const role of ['PREPRESS', 'READ_ONLY'] as const) {
        await expect(actions[method]({ ...staff, role }, input)).rejects.toBeInstanceOf(
          domain.OrderAdminActionAccessError,
        );
      }
      await expect(actions[method]({ ...staff, staffMemberId: '' }, input)).rejects.toBeInstanceOf(
        domain.OrderAdminActionAccessError,
      );
    },
  );

  it.each(['archive', 'unarchive'] as const)('%s validates request bounds', async (method) => {
    const actions = service();
    for (const invalid of [
      { orderNumber: '' },
      { orderNumber: '   ' },
      { orderNumber: null },
      { reasonCode: '' },
      { reasonCode: '   ' },
      { reasonCode: null },
      { note: 'x'.repeat(1001) },
      { note: null },
      { idempotencyKey: 'x'.repeat(11) },
      { idempotencyKey: ' '.repeat(12) },
      { idempotencyKey: 'x'.repeat(121) },
      { idempotencyKey: null },
    ]) {
      await expect(
        actions[method](staff, { ...input, ...invalid } as never),
      ).rejects.toBeInstanceOf(domain.OrderAdminActionValidationError);
    }
  });

  it.each(['OWNER', 'OPERATIONS'] as const)(
    'admits %s with inclusive key/note bounds',
    async (role) => {
      const actions = service();
      for (const method of ['archive', 'unarchive'] as const) {
        for (const length of [12, 120]) {
          await expect(
            actions[method](
              { ...staff, role },
              {
                ...input,
                note: 'x'.repeat(1000),
                idempotencyKey: 'x'.repeat(length),
              },
            ),
          ).rejects.toBe(databaseReached);
        }
        await expect(
          actions[method](
            { ...staff, role },
            {
              orderNumber: input.orderNumber,
              reasonCode: input.reasonCode,
              idempotencyKey: input.idempotencyKey,
            },
          ),
        ).rejects.toBe(databaseReached);
      }
    },
  );
});

describe('cancellation outcome orchestration', () => {
  // A local-only group must not count as a provider success when another provider refuses.
  it.each([
    { states: ['NOT_REQUIRED'], status: 'SUCCEEDED', orderStatus: 'CANCELLED', unresolved: [] },
    {
      states: ['CANCELLED', 'NOT_REQUIRED'],
      status: 'SUCCEEDED',
      orderStatus: 'CANCELLED',
      unresolved: [],
    },
    {
      states: ['UNAVAILABLE', 'NOT_REQUIRED'],
      status: 'FAILED',
      orderStatus: 'PAID',
      unresolved: ['group-0'],
    },
    { states: ['FAILED'], status: 'FAILED', orderStatus: 'PAID', unresolved: ['group-0'] },
    {
      states: ['CANCELLED', 'FAILED'],
      status: 'PARTIAL',
      orderStatus: 'ON_HOLD',
      unresolved: ['group-1'],
    },
    {
      states: ['CANCELLED', 'REQUESTED'],
      status: 'PARTIAL',
      orderStatus: 'ON_HOLD',
      unresolved: ['group-1'],
    },
  ])('orchestrates $states as $status', ({ states, status, orderStatus, unresolved }) => {
    expect(domain.resolveCancellationOutcome).toBeTypeOf('function');
    expect(
      domain.resolveCancellationOutcome(
        'PAID',
        states.map((state, index) => ({
          fulfillmentGroupId: `group-${index}`,
          status: state,
        })) as never,
      ),
    ).toEqual({ status, orderStatus, unresolvedFulfillmentGroupIds: unresolved });
  });

  it('requires authorization and valid refund intent before any database work', async () => {
    const actions = service();
    expect(actions.cancel).toBeTypeOf('function');
    const cancelInput = {
      ...input,
      refundDestination: 'LATER' as const,
      refundAmountCents: 0,
      notifyCustomer: true,
    };
    for (const role of ['PREPRESS', 'READ_ONLY'] as const) {
      await expect(actions.cancel({ ...staff, role }, cancelInput)).rejects.toBeInstanceOf(
        domain.OrderAdminActionAccessError,
      );
      await expect(
        actions.retryCancellation(
          { ...staff, role },
          {
            orderNumber: '#1',
            cancellationId: staff.staffMemberId,
            idempotencyKey: input.idempotencyKey,
          },
        ),
      ).rejects.toBeInstanceOf(domain.OrderAdminActionAccessError);
    }
    for (const invalid of [
      { refundDestination: 'RETURN' },
      { refundAmountCents: -1 },
      { refundAmountCents: 1.5 },
      { refundDestination: 'ORIGINAL_PAYMENT', refundAmountCents: 0 },
      { refundDestination: 'LATER', refundAmountCents: 100 },
      { notifyCustomer: 'yes' },
      { staffNote: 'x'.repeat(1001) },
      { idempotencyKey: 'short' },
      { reasonCode: '' },
    ])
      await expect(
        actions.cancel(staff, { ...cancelInput, ...invalid } as never),
      ).rejects.toBeInstanceOf(domain.OrderAdminActionValidationError);
    await expect(
      actions.retryCancellation(staff, {
        orderNumber: '#1',
        cancellationId: 'invalid',
        idempotencyKey: input.idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(domain.OrderAdminActionValidationError);
  });
});
