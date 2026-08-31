import { afterEach, describe, expect, it } from 'vitest';

import { POST as createCheckout } from '../app/api/carts/[cartId]/checkout/route.js';
import { POST as createGeneration } from '../app/api/projects/[projectId]/generations/route.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

function configure(input: Record<string, string>) {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://letitbe:letitbe@localhost:5432/letitbe',
    REDIS_URL: 'redis://localhost:6379',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    ...input,
  });
}

describe('operational kill-switch routes', () => {
  it('stops generation before session, queue, or provider side effects', async () => {
    configure({ GENERATION_ENABLED: 'false' });
    const response = await createGeneration(
      new Request('http://localhost/api/projects/guessed-project/generations', { method: 'POST' }),
      { params: Promise.resolve({ projectId: 'guessed-project' }) },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Generation is temporarily unavailable.',
    });
  });

  it('stops checkout creation before session, payment, or order side effects', async () => {
    configure({ CHECKOUT_ENABLED: 'false' });
    const response = await createCheckout(
      new Request('http://localhost/api/carts/guessed-cart/checkout', { method: 'POST' }),
      { params: Promise.resolve({ cartId: 'guessed-cart' }) },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Checkout is temporarily unavailable.',
    });
  });
});
