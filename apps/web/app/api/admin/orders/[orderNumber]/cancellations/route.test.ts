import { beforeEach, describe, expect, it } from 'vitest';
import {
  routeContract,
  uuid,
  doubles,
  requestFor,
  context,
  actor,
} from '../_actions/route-test-support';
import { POST } from './route';
const body = {
  reasonCode: 'CUSTOMER_CANCELLATION_REQUEST',
  refundDestination: 'LATER',
  refundAmountCents: 0,
  staffNote: 'Cancelled on request',
  notifyCustomer: false,
};
routeContract({
  name: 'Cancel order',
  handler: POST,
  service: 'cancel',
  body,
  invalid: [
    { ...body, notifyCustomer: 'yes' },
    { ...body, refundDestination: 'UNKNOWN' },
    { ...body, refundAmountCents: 1 },
    { ...body, staffNote: 'x'.repeat(1001) },
  ],
});
routeContract({
  name: 'Retry cancellation',
  handler: POST,
  service: 'retryCancellation',
  body: { cancellationId: uuid },
  invalid: [{ cancellationId: 'invalid' }, { cancellationId: uuid, reasonCode: 'RETRY' }],
});
describe('Cancellation outcomes', () => {
  beforeEach(() => {
    doubles.requireAdminSession.mockResolvedValue(actor);
    doubles.orderAdminActionsRuntime.mockResolvedValue({ actions: doubles });
  });
  for (const status of ['PARTIAL', 'FAILED'])
    it('does not report ' + status + ' cancellation as success', async () => {
      doubles.cancel.mockResolvedValue({ status, cancellationId: uuid });
      const response = await POST(requestFor(body), context);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'CANCELLATION_INCOMPLETE',
        result: { status },
      });
    });
  for (const status of ['REQUESTED', 'PROCESSING'])
    it('reports ' + status + ' cancellation as pending', async () => {
      doubles.cancel.mockResolvedValue({ status, cancellationId: uuid });
      const response = await POST(requestFor(body), context);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ result: { status } });
    });
});
