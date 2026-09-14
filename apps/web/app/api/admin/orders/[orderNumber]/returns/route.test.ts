import { routeContract, uuid } from '../_actions/route-test-support';
import { POST } from './route';
const body = {
  reasonCode: 'DAMAGED',
  shippingRequired: true,
  items: [{ orderItemId: uuid, quantity: 1 }],
  note: 'Print defect',
};
routeContract({
  name: 'Create Return',
  handler: POST,
  service: 'createReturn',
  body,
  invalid: [
    { ...body, items: [] },
    { ...body, items: [{ orderItemId: 'invalid', quantity: 1 }] },
    { ...body, items: [{ orderItemId: uuid, quantity: 1.1 }] },
    { ...body, items: [{ orderItemId: uuid, quantity: 1, refund: true }] },
    { ...body, shippingRequired: 'yes' },
  ],
});
