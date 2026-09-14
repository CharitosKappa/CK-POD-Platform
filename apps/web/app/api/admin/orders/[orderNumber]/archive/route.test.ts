import { routeContract } from '../_actions/route-test-support';
import { POST, DELETE } from './route';
for (const [handler, method, service] of [
  [POST, 'POST', 'archive'],
  [DELETE, 'DELETE', 'unarchive'],
] as const)
  routeContract({
    name: service,
    handler,
    method,
    service,
    body: { reasonCode: 'ADMIN_ORGANIZATION', note: 'Reviewed' },
    invalid: [
      { reasonCode: '' },
      { reasonCode: 'ARCHIVE', note: 5 },
      { reasonCode: 'ARCHIVE', note: 'x'.repeat(1001) },
    ],
  });
