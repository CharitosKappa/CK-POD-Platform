import { describe, expect, it } from 'vitest';

import { hasTrustedBrowserOrigin } from './middleware.js';

describe('browser mutation origin guard', () => {
  it('rejects forged and missing cross-origin headers', () => {
    expect(
      hasTrustedBrowserOrigin(
        new Headers({ origin: 'https://attacker.example', host: 'app.example' }),
      ),
    ).toBe(false);
    expect(hasTrustedBrowserOrigin(new Headers({ host: 'app.example' }))).toBe(false);
  });

  it('allows only the configured request host origin', () => {
    expect(
      hasTrustedBrowserOrigin(new Headers({ origin: 'https://app.example', host: 'app.example' })),
    ).toBe(true);
  });
});
