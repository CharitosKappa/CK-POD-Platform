import type { SqlPool } from '@let-it-be/db';
import { describe, expect, it } from 'vitest';

import {
  parseUsdCents,
  StoreCreditAccessError,
  StoreCreditService,
  StoreCreditValidationError,
  type StoreCreditAdjustmentInput,
  type StoreCreditStaffActor,
} from './store-credit';

const databaseReached = new Error('Database boundary reached');
const pool: SqlPool = {
  async query() {
    throw databaseReached;
  },
  async connect() {
    throw databaseReached;
  },
};
const service = new StoreCreditService(pool);
const customerId = '10000000-0000-4000-8000-000000000001';
const actor: StoreCreditStaffActor = {
  staffMemberId: '20000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: 'OWNER',
};
const input: StoreCreditAdjustmentInput = {
  direction: 'CREDIT',
  amount: '12.34',
  reason: 'REFUND',
  idempotencyKey: 'adjustment-key-0001',
};

describe('USD amount parsing', () => {
  it('accepts exact USD decimal strings and converts them to cents', () => {
    for (const [amount, cents] of [
      ['0.01', 1],
      ['0.29', 29],
      ['1', 100],
      ['12.3', 1230],
      [' 12.34 ', 1234],
      ['100000.00', 10_000_000],
    ] as const) {
      expect(parseUsdCents(amount)).toBe(cents);
    }
  });

  it('rejects zero, negative, exponent, comma, and over-two-decimal amounts', () => {
    for (const amount of [
      '0',
      '0.00',
      '-1',
      '+1',
      '1e2',
      '1,000',
      '1.001',
      '',
      '01',
      '.5',
      '1.',
      'NaN',
      'Infinity',
    ]) {
      expect(() => parseUsdCents(amount)).toThrow(StoreCreditValidationError);
    }
  });

  it('rejects adjustments above $100,000.00', () => {
    for (const amount of ['100000.01', '999999', '1000000']) {
      expect(() => parseUsdCents(amount)).toThrow(StoreCreditValidationError);
    }
  });
});

describe('Store Credit adjustment authorization and validation', () => {
  it.each(['PREPRESS', 'READ_ONLY'] as const)('denies %s staff adjustments', async (role) => {
    await expect(service.adjust({ ...actor, role }, customerId, input)).rejects.toBeInstanceOf(
      StoreCreditAccessError,
    );
  });

  it.each(['OWNER', 'OPERATIONS'] as const)('allows %s staff adjustments', async (role) => {
    await expect(service.adjust({ ...actor, role }, customerId, input)).rejects.toBe(
      databaseReached,
    );
  });

  it('requires a supported reason and limits the internal note to 1000 characters', async () => {
    for (const invalid of [
      { reason: '' },
      { reason: 'GRANT' },
      { note: 'x'.repeat(1001) },
      { note: 42 },
    ]) {
      await expect(
        service.adjust(actor, customerId, { ...input, ...invalid } as StoreCreditAdjustmentInput),
      ).rejects.toBeInstanceOf(StoreCreditValidationError);
    }
    for (const reason of ['REFUND', 'PROMOTION', 'CUSTOMER_SERVICE', 'OTHER'] as const) {
      await expect(
        service.adjust(actor, customerId, { ...input, reason, note: 'x'.repeat(1000) }),
      ).rejects.toBe(databaseReached);
    }
  });

  it('validates the customer UUID, direction, amount, and idempotency key before database access', async () => {
    await expect(service.adjust(actor, 'invalid', input)).rejects.toBeInstanceOf(
      StoreCreditValidationError,
    );
    for (const invalid of [
      { direction: 'GRANT' },
      { amount: 12 },
      { amount: '0' },
      { idempotencyKey: '' },
      { idempotencyKey: 'x'.repeat(11) },
      { idempotencyKey: 'x'.repeat(121) },
      { idempotencyKey: ' '.repeat(12) },
    ]) {
      await expect(
        service.adjust(actor, customerId, { ...input, ...invalid } as StoreCreditAdjustmentInput),
      ).rejects.toBeInstanceOf(StoreCreditValidationError);
    }
    for (const idempotencyKey of ['x'.repeat(12), 'x'.repeat(120)]) {
      await expect(service.adjust(actor, customerId, { ...input, idempotencyKey })).rejects.toBe(
        databaseReached,
      );
    }
  });
});
