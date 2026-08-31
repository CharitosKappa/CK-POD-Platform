import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FakeLifecycleMessagingService,
  KlaviyoLifecycleMessagingService,
} from './operations-analytics.js';

describe('lifecycle messaging adapters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses deterministic fake delivery identifiers without exposing customer payloads', async () => {
    const result = await new FakeLifecycleMessagingService().send({
      type: 'ORDER_CONFIRMATION',
      classification: 'TRANSACTIONAL',
      recipientEmail: 'customer@example.test',
      idempotencyKey: 'order-confirmation:order-1',
      payload: { orderNumber: 'LIB-1' },
    });
    expect(result.providerMessageId).toMatch(/^fake_email_/);
    expect(result.providerMessageId).not.toContain('customer');
  });

  it('keeps Klaviyo behind the lifecycle adapter and sends only caller-minimized fields', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, headers: new Headers({ 'request-id': 'req-1' }) });
    vi.stubGlobal('fetch', fetch);
    const adapter = new KlaviyoLifecycleMessagingService(
      'test-key',
      'https://klaviyo.example.test',
    );
    await expect(
      adapter.send({
        type: 'WELCOME',
        classification: 'MARKETING',
        recipientEmail: 'customer@example.test',
        idempotencyKey: 'welcome:1',
        payload: { projectId: 'project-1' },
      }),
    ).resolves.toEqual({ providerMessageId: 'req-1' });
    expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain('production');
    expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain('prompt');
  });
});
