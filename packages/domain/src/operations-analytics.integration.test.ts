import { randomBytes } from 'node:crypto';

import { createDatabaseClient, integrationTestDatabaseUrl, type SqlPool } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AnalyticsEventService,
  LifecycleOrchestrator,
  type LifecycleMessagingService,
} from './operations-analytics.js';

const integrationDatabaseUrl = integrationTestDatabaseUrl(process.env);
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;

integrationSuite('M9 analytics and lifecycle integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    close = database.close;
  });

  afterAll(async () => close());

  it('reserves a transactional outbox in the caller transaction and dispatches its stored payload only once', async () => {
    const send = vi
      .fn<LifecycleMessagingService['send']>()
      .mockResolvedValue({ providerMessageId: 'outbox-message' });
    const lifecycle = new LifecycleOrchestrator(pool, { send }, 'FAKE');
    expect(lifecycle.enqueueTransactionalWithClient).toBeTypeOf('function');
    const input = {
      type: 'ORDER_CANCELLATION' as const,
      recipientEmail: `outbox-${randomBytes(6).toString('hex')}@example.test`,
      idempotencyKey: `outbox-${randomBytes(6).toString('hex')}`,
      payload: { orderNumber: '#outbox', preferredLocale: 'injected' },
    };
    await pool.query(
      `INSERT INTO app.customer_profiles (normalized_email,first_seen_source,preferred_locale,preferred_locale_source)
      VALUES ($1,'CHECKOUT','en','ADMIN')`,
      [input.recipientEmail],
    );
    const client = await pool.connect();
    let deliveryId: string;
    try {
      await client.query('BEGIN');
      deliveryId = await lifecycle.enqueueTransactionalWithClient(client, input);
      expect(
        (await pool.query(`SELECT id FROM app.lifecycle_deliveries WHERE id=$1`, [deliveryId]))
          .rows,
      ).toEqual([]);
      expect(send).not.toHaveBeenCalled();
      await client.query('ROLLBACK');
      expect(
        (await pool.query(`SELECT id FROM app.lifecycle_deliveries WHERE id=$1`, [deliveryId]))
          .rows,
      ).toEqual([]);
      await client.query('BEGIN');
      deliveryId = await lifecycle.enqueueTransactionalWithClient(client, input);
      expect(await lifecycle.enqueueTransactionalWithClient(client, input)).toBe(deliveryId);
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await Promise.all([
      lifecycle.dispatchDelivery(deliveryId!),
      lifecycle.dispatchDelivery(deliveryId!),
    ]);
    expect(
      (
        await pool.query(
          `SELECT status,payload,provider_message_id FROM app.lifecycle_deliveries WHERE id=$1`,
          [deliveryId!],
        )
      ).rows,
    ).toEqual([
      {
        status: 'SENT',
        payload: { orderNumber: '#outbox', preferredLocale: 'en' },
        provider_message_id: 'outbox-message',
      },
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({
      preferredLocale: 'en',
      type: 'ORDER_CANCELLATION',
    });
  });

  it('deduplicates platform analytics and exposes unavailable economics honestly', async () => {
    const analytics = new AnalyticsEventService(pool);
    const key = `analytics-m9-${randomBytes(6).toString('hex')}`;
    await Promise.all([
      analytics.emit({
        name: 'session_started',
        idempotencyKey: key,
        sessionId: 'session-1',
        dimensions: {
          source: 'DIRECT',
          styleFamilyId: 'minimal-line',
          presetId: 'minimal-line-v1',
          presetVersion: '1',
        },
      }),
      analytics.emit({
        name: 'session_started',
        idempotencyKey: key,
        sessionId: 'session-1',
        dimensions: {
          source: 'DIRECT',
          styleFamilyId: 'minimal-line',
          presetId: 'minimal-line-v1',
          presetVersion: '1',
        },
      }),
    ]);
    const rows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.analytics_events WHERE idempotency_key = $1`,
      [key],
    );
    expect(rows.rows[0]?.count).toBe('1');
    const dashboard = await analytics.dashboard(new Date('2020-01-01'), new Date('2030-01-01'));
    expect(dashboard.taxRevenueCents).toBe(0);
    expect(dashboard.cacCents).toBe('UNAVAILABLE');
    expect(dashboard.ltvCents).toBe('UNAVAILABLE');
    expect(dashboard.contributionMarginCents).toBe('INCOMPLETE');
    expect(
      await analytics.styleAttribution(new Date('2020-01-01'), new Date('2030-01-01')),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          styleFamilyId: 'minimal-line',
          presetId: 'minimal-line-v1',
          presetVersion: '1',
        }),
      ]),
    );
  });

  it('sends one minimized lifecycle message per key and suppresses pending abandonment after purchase', async () => {
    const send = vi
      .fn<LifecycleMessagingService['send']>()
      .mockResolvedValue({ providerMessageId: 'fake-m9' });
    const lifecycle = new LifecycleOrchestrator(pool, { send }, 'FAKE');
    const recipientEmail = `m9-${randomBytes(6).toString('hex')}@example.test`;
    await pool.query(
      `INSERT INTO app.customer_profiles (
         normalized_email, first_seen_source, preferred_locale, preferred_locale_source
       ) VALUES ($1, 'CHECKOUT', 'en', 'BROWSER')`,
      [recipientEmail],
    );
    const sentKey = `welcome-${randomBytes(6).toString('hex')}`;
    await Promise.all([
      lifecycle.trigger({
        type: 'WELCOME',
        classification: 'MARKETING',
        recipientEmail,
        idempotencyKey: sentKey,
        payload: { projectId: 'project-safe' },
      }),
      lifecycle.trigger({
        type: 'WELCOME',
        classification: 'MARKETING',
        recipientEmail,
        idempotencyKey: sentKey,
        payload: { projectId: 'project-safe' },
      }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ preferredLocale: 'en' }));
    expect(JSON.stringify(send.mock.calls[0])).not.toContain('prompt');
    const sentDelivery = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM app.lifecycle_deliveries WHERE idempotency_key=$1`,
      [sentKey],
    );
    expect(sentDelivery.rows[0]?.payload).toMatchObject({ preferredLocale: 'en' });
    const pendingKey = `cart-${randomBytes(6).toString('hex')}`;
    await pool.query(
      `INSERT INTO app.lifecycle_deliveries (message_type, channel, classification, recipient_email, idempotency_key, provider, status, payload) VALUES ('CART_ABANDONMENT','EMAIL','MARKETING',$1,$2,'FAKE','PENDING','{}'::jsonb)`,
      [recipientEmail, pendingKey],
    );
    await lifecycle.suppressAbandonment({ recipientEmail });
    const suppressed = await pool.query<{ status: string }>(
      `SELECT status FROM app.lifecycle_deliveries WHERE idempotency_key = $1`,
      [pendingKey],
    );
    expect(suppressed.rows[0]?.status).toBe('SUPPRESSED');
  });

  it('records a provider delivery failure once without retrying the same idempotency key blindly', async () => {
    const send = vi
      .fn<LifecycleMessagingService['send']>()
      .mockRejectedValue(new Error('synthetic lifecycle provider outage'));
    const lifecycle = new LifecycleOrchestrator(pool, { send }, 'FAKE');
    const key = `lifecycle-failure-${randomBytes(6).toString('hex')}`;
    const input = {
      type: 'WELCOME' as const,
      classification: 'MARKETING' as const,
      recipientEmail: `failure-${randomBytes(6).toString('hex')}@example.test`,
      idempotencyKey: key,
      payload: { projectId: 'safe-project-id' },
    };
    await lifecycle.trigger(input);
    await lifecycle.trigger(input);
    expect(send).toHaveBeenCalledTimes(1);
    const delivery = await pool.query<{ status: string; provider_message_id: string | null }>(
      `SELECT status, provider_message_id FROM app.lifecycle_deliveries WHERE idempotency_key = $1`,
      [key],
    );
    expect(delivery.rows[0]).toEqual({ status: 'FAILED', provider_message_id: null });
  });
});
