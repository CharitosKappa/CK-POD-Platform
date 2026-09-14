import { expect, it } from 'vitest';
import {
  routeContract,
  uuid,
  doubles,
  actor,
  requestFor,
} from '../../../_actions/route-test-support';
import { POST } from './route';
const body = {
  toState: 'IN_TRANSIT',
  carrier: 'UPS',
  trackingNumber: '1Z123',
  note: 'Handed over',
};
routeContract({
  name: 'Return transition',
  handler: POST,
  service: 'transitionReturn',
  body,
  forwarded: { ...body, returnId: uuid },
  invalid: [
    { ...body, toState: 'REFUNDED' },
    { ...body, carrier: 9 },
    { ...body, trackingNumber: 9 },
    { ...body, note: 'x'.repeat(1001) },
  ],
});
it('rejects a malformed return route identifier before calling the service', async () => {
  doubles.requireAdminSession.mockResolvedValue(actor);
  const response = await POST(requestFor(body), {
    params: Promise.resolve({ orderNumber: '%231', returnId: 'malformed' }),
  });
  expect(response.status).toBe(400);
});
