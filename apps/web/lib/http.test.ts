import { GenerationCreditError } from '@let-it-be/domain';
import { describe, expect, it } from 'vitest';

import { handleRouteError } from './http';

describe('customer-facing route errors', () => {
  it('uses design credit terminology while preserving the generation credit error contract', async () => {
    const response = handleRouteError(
      new GenerationCreditError('No generation credits are currently available.'),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'No design credits are currently available.',
      code: 'NO_GENERATION_CREDIT',
    });
  });
});
