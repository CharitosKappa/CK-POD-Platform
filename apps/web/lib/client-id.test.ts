import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientIdempotencyKey } from './client-id';

describe('createClientIdempotencyKey', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a UUID-shaped secure fallback when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(values: Uint8Array) {
        values.fill(0xab);
        return values;
      },
    });

    expect(createClientIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
