import { describe, expect, it, vi } from 'vitest';

import type { SqlPool } from '@let-it-be/db';
import { InMemoryJobQueue } from '@let-it-be/queue';
import { MemoryObjectStorage } from '@let-it-be/storage';

import { OrderExportService, synchronousOrderExportLimit } from './order-exports';

const actor = {
  id: 'session-1',
  staffMemberId: '00000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS' as const,
  email: 'ops@example.test',
  expiresAt: new Date('2026-09-14T00:00:00Z'),
};
const orderId = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-09-13T12:00:00Z');

describe('hybrid order exports', () => {
  it('rejects impossible calendar dates before querying PostgreSQL', async () => {
    const query = vi.fn();
    const service = new OrderExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    await expect(
      service.request(actor, {
        type: 'FILTER',
        filters: { view: 'ALL', dateFrom: '2026-02-31' },
      }),
    ).rejects.toThrow('Enter a valid start date.');
    expect(query).not.toHaveBeenCalled();
  });

  it('returns small exports immediately with persisted layer values', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT count')) return { rows: [{ count: 1 }], rowCount: 1 };
      if (sql.includes('SELECT orders.id,'))
        return {
          rows: [
            {
              id: orderId,
              order_number: '#1',
              created_at: now,
              customer_name: 'Taylor Example',
              customer_email: 'taylor@example.test',
              products: ['Classic T-Shirt'],
              item_count: 1,
              payment_status: 'SUCCEEDED',
              printing_status: 'PRINTED',
              fulfillment_status: 'FULFILLED',
              total_cents: 3999,
              currency: 'USD',
              shipping_city: 'Miami',
              shipping_state: 'FL',
              shipping_country: 'US',
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    });
    const service = new OrderExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    const result = await service.request(actor, { type: 'IDS', orderIds: [orderId] });

    expect(result.mode).toBe('IMMEDIATE');
    if (result.mode === 'IMMEDIATE') {
      const csv = new TextDecoder().decode(result.body);
      expect(csv).toContain('Order ID,Created at,Customer name');
      expect(csv).toContain('#1,2026-09-13T12:00:00.000Z,Taylor Example');
      expect(csv).toContain('SUCCEEDED,PRINTED,FULFILLED,39.99,USD');
    }
  });

  it('uses the shared joined order filter contract for filtered exports', async () => {
    const executedValues: Array<readonly unknown[] | undefined> = [];
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      executedValues.push(values);
      if (sql.startsWith('SELECT count')) return { rows: [{ count: 1 }], rowCount: 1 };
      if (sql.includes('SELECT orders.id,'))
        return {
          rows: [
            {
              id: orderId,
              order_number: '#1',
              created_at: now,
              customer_name: 'Taylor Example',
              customer_email: 'taylor@example.test',
              products: ['Classic T-Shirt'],
              item_count: 1,
              payment_status: 'SUCCEEDED',
              printing_status: 'PRINTED',
              fulfillment_status: 'FULFILLED',
              total_cents: 3999,
              currency: 'USD',
              shipping_city: 'Miami',
              shipping_state: 'FL',
              shipping_country: 'US',
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    });
    const service = new OrderExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    await service.request(actor, {
      type: 'FILTER',
      filters: {
        view: 'IN_PROGRESS',
        paymentStatus: 'SUCCEEDED',
        printingStatus: 'PRINTED',
        fulfillmentStatus: 'FULFILLED',
      },
    });

    const countSql = String(query.mock.calls[0]?.[0]);
    expect(countSql).toContain('LEFT JOIN LATERAL');
    expect(executedValues[0]).toEqual(
      expect.arrayContaining(['SUCCEEDED', 'PRINTED', 'FULFILLED']),
    );
  });

  it('persists and queues exports above the synchronous threshold', async () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000003',
      requested_by_staff_member_id: actor.staffMemberId,
      status: 'QUEUED',
      selection_snapshot: { type: 'FILTER', filters: { view: 'ALL' } },
      total_count: synchronousOrderExportLimit + 1,
      processed_count: 0,
      storage_key: null,
      file_name: 'orders-2026-09-13.csv',
      failure_reason: null,
      queue_job_id: null,
      expires_at: null,
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT count'))
        return { rows: [{ count: synchronousOrderExportLimit + 1 }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO app.order_exports')) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const service = new OrderExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    const result = await service.request(actor, { type: 'FILTER', filters: { view: 'ALL' } });

    expect(result).toMatchObject({
      mode: 'QUEUED',
      export: { status: 'QUEUED', totalCount: synchronousOrderExportLimit + 1 },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app.order_exports'),
      expect.any(Array),
    );
  });
});
