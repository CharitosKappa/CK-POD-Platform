import { describe, expect, it } from 'vitest';

import { decodeOrderNumberRouteParam } from './order-number-route';

describe('decodeOrderNumberRouteParam', () => {
  it('decodes a hash-prefixed order number exactly once', () => {
    expect(decodeOrderNumberRouteParam('%23162')).toBe('#162');
  });

  it('leaves an already-decoded order number unchanged', () => {
    expect(decodeOrderNumberRouteParam('#162')).toBe('#162');
  });
});
