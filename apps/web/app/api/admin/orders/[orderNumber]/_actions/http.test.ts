import { describe, expect, it } from 'vitest';
import { CommerceAccessError, FulfillmentIntegrationError } from '@let-it-be/domain';
import * as http from '../../../../../../lib/http';
describe('Order action error boundary', () => {
  it('maps a real repricing mapping conflict to safe 409 without changing legacy access errors', async () => {
    const error = new CommerceAccessError('Shipping is unavailable: provider-private-data');
    expect(http.handleRouteError(error).status).toBe(404);
    const response = http.handleOrderActionRouteError(error);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ORDER_ACTION_CONFLICT' });
    expect(await http.handleOrderActionRouteError(error).text()).not.toContain(
      'provider-private-data',
    );
  });
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
