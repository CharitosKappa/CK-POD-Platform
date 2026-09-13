import { MemoryObjectStorage } from '@let-it-be/storage';
import type { SqlPool } from '@let-it-be/db';
import { describe, expect, it } from 'vitest';
import { FakePrintifyFulfillmentAdapter } from './printify';
import { OrderOperationsAccessError, OrderOperationsService } from './order-operations';

describe('canonical cancellation authority', () => {
  it('rejects read-only staff before entering its caller transaction', async () => {
    const pool: SqlPool = {
      async query() {
        throw new Error('Unexpected DB access');
      },
      async connect() {
        throw new Error('Unexpected DB connection');
      },
    };
    const operations = new OrderOperationsService(
      pool,
      new MemoryObjectStorage(),
      new FakePrintifyFulfillmentAdapter(),
      { fulfillmentAdapter: 'fake', realProductionSubmissionEnabled: false },
    );
    expect(operations.finalizeCancellationWithClient).toBeTypeOf('function');
    await expect(
      operations.finalizeCancellationWithClient(
        pool,
        {
          id: 'session',
          staffMemberId: 'staff',
          role: 'READ_ONLY',
          email: 'readonly@example.test',
          expiresAt: new Date('2099-01-01'),
        },
        { orderNumber: '#1', cancellationId: 'cancellation' },
      ),
    ).rejects.toBeInstanceOf(OrderOperationsAccessError);
  });
});
