import { describe, expect, it } from 'vitest';
import { FulfillmentIntegrationError } from '@let-it-be/domain';
import * as http from '../../../../../../lib/http';
describe('Order action error boundary', () => {
  it('preserves the pre-existing error contract for other routes', () => {
    expect(
      http.handleRouteError(new FulfillmentIntegrationError('PROVIDER_ERROR', 'private')).status,
    ).toBe(500);
  });
  it('returns a typed safe tax-provider failure for order repricing', async () => {
    expect(http).toHaveProperty('handleOrderActionRouteError');
    const response = (
      http as unknown as { handleOrderActionRouteError: (error: unknown) => Response }
    ).handleOrderActionRouteError(new Error('Tax calculation could not be completed.'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ORDER_PROVIDER_FAILURE' });
  });
});
