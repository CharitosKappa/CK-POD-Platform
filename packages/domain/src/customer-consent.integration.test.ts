import { randomUUID } from 'node:crypto';

import { createDatabaseClient, integrationTestDatabaseUrl } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CustomerOperationsService } from './customer-operations';

const integrationDatabaseUrl = integrationTestDatabaseUrl(process.env);
const suite = integrationDatabaseUrl ? describe : describe.skip;

suite('customer marketing consent integration', () => {
  const database = createDatabaseClient(integrationDatabaseUrl!);
  const service = new CustomerOperationsService(database.pool);
  const customerId = randomUUID();
  const email = `consent-${customerId}@example.test`;
  const actor = {
    staffMemberId: randomUUID(),
    email: `consent-admin-${randomUUID()}@example.test`,
    role: 'OPERATIONS' as const,
  };

  beforeAll(async () => {
    await database.pool.query(
      `INSERT INTO app.staff_members (id,normalized_email,role,status)
       VALUES ($1,$2,'OPERATIONS','ACTIVE')`,
      [actor.staffMemberId, actor.email],
    );
    await database.pool.query(
      `INSERT INTO app.customer_profiles (id,normalized_email,first_seen_source)
       VALUES ($1,$2,'CHECKOUT')`,
      [customerId, email],
    );
  });

  afterAll(async () => {
    await database.pool.query('DELETE FROM app.customer_profiles WHERE id=$1', [customerId]);
    await database.pool.query('DELETE FROM app.staff_members WHERE id=$1', [actor.staffMemberId]);
    await database.close();
  });

  it('distinguishes never subscribed, subscribed, unsubscribed, and resubscribed states', async () => {
    await expect(currentEmailStatus()).resolves.toBe('NOT_SUBSCRIBED');

    await updateEmailSubscription('SUBSCRIBED');
    await expect(currentEmailStatus()).resolves.toBe('SUBSCRIBED');

    await updateEmailSubscription('NOT_SUBSCRIBED');
    const unsubscribed = await currentEmailConsent();
    expect(unsubscribed.status).toBe('UNSUBSCRIBED');

    await updateEmailSubscription('NOT_SUBSCRIBED');
    const unchanged = await currentEmailConsent();
    expect(unchanged).toEqual(unsubscribed);

    await updateEmailSubscription('SUBSCRIBED');
    await expect(currentEmailStatus()).resolves.toBe('SUBSCRIBED');

    const events = await database.pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM app.customer_timeline_events
       WHERE customer_profile_id=$1 AND event_type='CONSENT_UPDATED'
       ORDER BY created_at,id`,
      [customerId],
    );
    expect(events.rows.map((event) => event.metadata)).toEqual([
      {
        email: { previousStatus: 'NOT_SUBSCRIBED', newStatus: 'SUBSCRIBED' },
        source: 'ADMIN',
      },
      {
        email: { previousStatus: 'SUBSCRIBED', newStatus: 'UNSUBSCRIBED' },
        source: 'ADMIN',
      },
      {
        email: { previousStatus: 'UNSUBSCRIBED', newStatus: 'SUBSCRIBED' },
        source: 'ADMIN',
      },
    ]);
  });

  async function updateEmailSubscription(status: 'NOT_SUBSCRIBED' | 'SUBSCRIBED') {
    await service.updateCustomer(actor, customerId, {
      email,
      emailMarketingStatus: status,
      smsMarketingStatus: 'NOT_SUBSCRIBED',
    });
  }

  async function currentEmailStatus() {
    return (await currentEmailConsent()).status;
  }

  async function currentEmailConsent() {
    const result = await database.pool.query<{
      email_marketing_status: string;
      email_marketing_updated_at: Date;
    }>(
      `SELECT email_marketing_status,email_marketing_updated_at
       FROM app.customer_profiles WHERE id=$1`,
      [customerId],
    );
    return {
      status: result.rows[0]?.email_marketing_status,
      updatedAt: result.rows[0]?.email_marketing_updated_at,
    };
  }
});
