import { randomUUID } from 'node:crypto';

import { createDatabaseClient } from '@let-it-be/db';
import { InMemoryJobQueue } from '@let-it-be/queue';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CustomerExportService, startCustomerExportConsumer } from './customer-exports';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('hybrid customer exports integration', () => {
  const database = createDatabaseClient(process.env.DATABASE_URL!);
  const queue = new InMemoryJobQueue();
  const storage = new MemoryObjectStorage();
  const staffMemberId = randomUUID();
  const marker = `export-${randomUUID().slice(0, 8)}`;
  const actor = {
    staffMemberId,
    role: 'OPERATIONS' as const,
    email: `${marker}@example.test`,
  };

  beforeAll(async () => {
    await database.pool.query(
      `INSERT INTO app.staff_members (id,normalized_email,role,status,activated_at)
       VALUES ($1,$2,'OPERATIONS','ACTIVE',now())`,
      [staffMemberId, actor.email],
    );
    await database.pool.query(
      `INSERT INTO app.customer_profiles
       (normalized_email,first_seen_source,first_seen_at,last_seen_at)
       SELECT $1 || '-' || value || '@example.test','ACCOUNT',now(),now()
       FROM generate_series(1,1001) value`,
      [marker],
    );
  });

  afterAll(async () => {
    const exports = await database.pool.query<{ storage_key: string | null }>(
      `SELECT storage_key FROM app.customer_exports WHERE requested_by_staff_member_id=$1`,
      [staffMemberId],
    );
    for (const row of exports.rows) if (row.storage_key) await storage.delete(row.storage_key);
    await database.pool.query(
      `DELETE FROM app.customer_exports WHERE requested_by_staff_member_id=$1`,
      [staffMemberId],
    );
    await database.pool.query(`DELETE FROM app.staff_audit_events WHERE staff_member_id=$1`, [
      staffMemberId,
    ]);
    await database.pool.query(`DELETE FROM app.customer_profiles WHERE normalized_email LIKE $1`, [
      `${marker}-%`,
    ]);
    await database.pool.query(`DELETE FROM app.staff_members WHERE id=$1`, [staffMemberId]);
    await queue.close();
    await database.close();
  });

  it('queues, streams, persists, lists, and downloads a large filtered export', async () => {
    const service = new CustomerExportService(database.pool, queue, storage);
    await startCustomerExportConsumer(queue, (exportId) => service.process(exportId));

    const requested = await service.request(actor, {
      type: 'FILTER',
      filters: { query: marker, view: 'ALL' },
    });
    expect(requested.mode).toBe('QUEUED');
    if (requested.mode !== 'QUEUED') return;

    await queue.waitForIdle();
    const [completed] = await service.list(actor);
    expect(completed).toMatchObject({
      id: requested.export.id,
      status: 'READY',
      totalCount: 1001,
      processedCount: 1001,
    });

    const download = await service.download(actor, requested.export.id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of download.object.body) chunks.push(chunk);
    const csv = new TextDecoder().decode(chunks[0]);
    expect(csv).toContain(`${marker}-1@example.test`);
    expect(csv.trim().split('\r\n')).toHaveLength(1002);
  });
});
