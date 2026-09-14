import type { SqlPool } from '@let-it-be/db';
import { describe, expect, it } from 'vitest';

import * as domain from './index';

const databaseReached = new Error('Database boundary reached');
const pool: SqlPool = {
  async query() {
    throw databaseReached;
  },
  async connect() {
    throw databaseReached;
  },
};
const payments = new domain.FakePaymentService();
const staff = {
  id: 'session',
  staffMemberId: '20000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS' as const,
  email: 'operations@example.test',
  expiresAt: new Date('2099-01-01'),
};
const input = {
  orderNumber: '#1',
  idempotencyKey: 'order-edit-payment-0001',
};

describe('order edit additional payment preflight', () => {
  it('exports the separate payment service and rejects unauthorized actors before persistence', async () => {
    expect(domain.OrderEditPaymentService).toBeTypeOf('function');
    const service = new domain.OrderEditPaymentService(pool, payments);
    for (const role of ['READ_ONLY', 'PREPRESS'] as const)
      await expect(service.prepare({ ...staff, role }, input)).rejects.toBeInstanceOf(
        domain.OrderAdminActionAccessError,
      );
    for (const role of ['READ_ONLY', 'PREPRESS'] as const)
      await expect(service.reconcile({ ...staff, role }, input)).rejects.toBeInstanceOf(
        domain.OrderAdminActionAccessError,
      );
    for (const role of ['READ_ONLY', 'PREPRESS'] as const)
      await expect(
        service.readOrRecover({ ...staff, role }, { orderNumber: '#1' }),
      ).rejects.toBeInstanceOf(domain.OrderAdminActionAccessError);
    await expect(service.prepare(staff, input)).rejects.toBe(databaseReached);
    await expect(service.reconcile(staff, input)).rejects.toBe(databaseReached);
    await expect(service.readOrRecover(staff, { orderNumber: '#1' })).rejects.toBe(databaseReached);
  });

  it('rejects malformed order and idempotency references before persistence', async () => {
    const service = new domain.OrderEditPaymentService(pool, payments);
    for (const invalid of [
      { orderNumber: '1' },
      { idempotencyKey: 'short' },
      { idempotencyKey: 'x'.repeat(121) },
    ])
      await expect(service.prepare(staff, { ...input, ...invalid })).rejects.toBeInstanceOf(
        domain.OrderAdminActionValidationError,
      );
    for (const invalid of [
      { orderNumber: '1' },
      { idempotencyKey: 'short' },
      { idempotencyKey: 'x'.repeat(121) },
    ])
      await expect(service.reconcile(staff, { ...input, ...invalid })).rejects.toBeInstanceOf(
        domain.OrderAdminActionValidationError,
      );
    await expect(service.readOrRecover(staff, { orderNumber: '1' })).rejects.toBeInstanceOf(
      domain.OrderAdminActionValidationError,
    );
  });
});
