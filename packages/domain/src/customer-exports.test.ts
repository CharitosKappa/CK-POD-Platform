import { describe, expect, it, vi } from 'vitest';

import type { SqlPool } from '@let-it-be/db';
import { InMemoryJobQueue } from '@let-it-be/queue';
import { MemoryObjectStorage } from '@let-it-be/storage';

import { CustomerExportService, synchronousCustomerExportLimit } from './customer-exports';

const actor = {
  staffMemberId: '00000000-0000-4000-8000-000000000001',
  role: 'OPERATIONS' as const,
  email: 'operations@example.test',
};
const customerId = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-09-11T18:00:00.000Z');

describe('hybrid customer exports', () => {
  it('returns small exports immediately', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT count')) return { rows: [{ count: 1 }], rowCount: 1 };
      if (sql.includes('SELECT cp.id,'))
        return {
          rows: [
            {
              id: customerId,
              name: 'Taylor Example',
              email: 'taylor@example.test',
              phone: null,
              location: 'Athens, GR',
              email_marketing_status: 'SUBSCRIBED',
              sms_marketing_status: 'UNKNOWN',
              order_count: 2,
              total_spent_cents: 7998,
              last_order_at: now,
              tags: ['returning'],
              created_at: now,
              updated_at: now,
            },
          ],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    });
    const service = new CustomerExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    const result = await service.request(actor, { type: 'IDS', customerIds: [customerId] });

    expect(result.mode).toBe('IMMEDIATE');
    if (result.mode === 'IMMEDIATE') {
      expect(new TextDecoder().decode(result.body)).toContain('Taylor Example');
      expect(result.totalCount).toBe(1);
    }
  });

  it('persists and queues exports above the synchronous threshold', async () => {
    const exportRow = {
      id: '00000000-0000-4000-8000-000000000003',
      requested_by_staff_member_id: actor.staffMemberId,
      status: 'QUEUED',
      selection_snapshot: { type: 'FILTER', filters: { view: 'ALL' } },
      total_count: synchronousCustomerExportLimit + 1,
      processed_count: 0,
      storage_key: null,
      file_name: 'customers-2026-09-11.csv',
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
        return { rows: [{ count: synchronousCustomerExportLimit + 1 }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO app.customer_exports'))
        return { rows: [exportRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const service = new CustomerExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    const result = await service.request(actor, { type: 'FILTER', filters: { view: 'ALL' } });

    expect(result).toMatchObject({
      mode: 'QUEUED',
      export: { status: 'QUEUED', totalCount: synchronousCustomerExportLimit + 1 },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app.customer_exports'),
      expect.any(Array),
    );
  });

  it('maps legacy NEW export snapshots to the recently-added segment', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: customerId }], rowCount: 1 });
    const service = new CustomerExportService(
      { query } as unknown as SqlPool,
      new InMemoryJobQueue(),
      new MemoryObjectStorage(),
    );

    await service.resolveIds(actor, {
      type: 'FILTER',
      filters: { view: 'NEW' as never },
    });

    expect(query.mock.calls[0]?.[0]).toContain("cp.first_seen_at >= now() - interval '30 days'");
  });
});
