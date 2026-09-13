import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Orders client boundary', () => {
  it.each(['admin-orders-client.tsx', 'order-list-url-state.ts'])(
    'keeps server-only domain runtime out of %s',
    (file) => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/from ['"]@let-it-be\/domain['"]/);
    },
  );
});
