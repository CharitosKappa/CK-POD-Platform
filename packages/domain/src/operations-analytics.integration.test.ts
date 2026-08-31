import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AnalyticsEventService,
  LifecycleOrchestrator,
  type LifecycleMessagingService,
} from './operations-analytics.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
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
    expect(JSON.stringify(send.mock.calls[0])).not.toContain('prompt');
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
});
