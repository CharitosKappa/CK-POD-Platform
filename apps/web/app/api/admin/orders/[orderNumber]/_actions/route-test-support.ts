import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FulfillmentIntegrationError,
  OrderAdminActionAccessError,
  OrderAdminActionConflictError,
  OrderAdminActionNotFoundError,
  OrderAdminActionValidationError,
  StaffAuthenticationError,
} from '@let-it-be/domain';

const doubles = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  orderAdminActionsRuntime: vi.fn(),
  editOrder: vi.fn(),
  cancel: vi.fn(),
  retryCancellation: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  createReturn: vi.fn(),
  transitionReturn: vi.fn(),
  refundOriginalPayment: vi.fn(),
  refundToStoreCredit: vi.fn(),
  getOrder: vi.fn(),
}));
export { doubles };
vi.mock('../../../../../../lib/platform', () => ({
  requireAdminSession: doubles.requireAdminSession,
  orderAdminActionsRuntime: doubles.orderAdminActionsRuntime,
}));
export const uuid = '11111111-1111-4111-8111-111111111111';
export const actor = { staffMemberId: uuid, role: 'OPERATIONS', email: 'ops@example.test' };
export const key = 'admin-action-key-123';
type Handler = (
  request: Request,
  context: { params: Promise<{ orderNumber: string; returnId: string }> },
) => Promise<Response>;
export function requestFor(body: unknown, method = 'POST', idempotencyKey: string | null = key) {
  return new Request('http://localhost/api/admin/orders/%231/archive', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey === null ? {} : { 'Idempotency-Key': idempotencyKey }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
export const context = { params: Promise.resolve({ orderNumber: '%231', returnId: uuid }) };
export function routeContract(input: {
  name: string;
  handler: Handler;
  method?: string;
  service: keyof typeof doubles;
  body: Record<string, unknown>;
  forwarded?: Record<string, unknown>;
  invalid: unknown[];
  result?: Record<string, unknown>;
  refund?: boolean;
}) {
  describe(input.name, () => {
    beforeEach(() => {
      vi.resetAllMocks();
      doubles.requireAdminSession.mockResolvedValue(actor);
      doubles.getOrder.mockResolvedValue({ id: uuid });
      doubles.orderAdminActionsRuntime.mockResolvedValue({
        actions: doubles,
        refunds: doubles,
        detail: { getOrder: doubles.getOrder },
      });
      doubles[input.service].mockResolvedValue(input.result ?? { duplicate: false });
    });
    for (const role of ['OPERATIONS', 'OWNER'])
      it(`allows ${role}, decodes the order, and forwards only the accepted fields`, async () => {
        doubles.requireAdminSession.mockResolvedValue({ ...actor, role });
        const response = await input.handler(requestFor(input.body, input.method), context);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ result: input.result ?? { duplicate: false } });
        expect(doubles[input.service]).toHaveBeenCalledWith(
          input.refund ? { type: 'STAFF', ...actor, role } : { ...actor, role },
          { ...(input.forwarded ?? input.body), orderNumber: '#1', idempotencyKey: key },
        );
      });
    it('requires an authenticated admin before parsing or constructing services', async () => {
      doubles.requireAdminSession.mockRejectedValue(
        new StaffAuthenticationError('Admin authentication is required.'),
      );
      const response = await input.handler(requestFor('{', input.method), context);
      expect(response.status).toBe(401);
      expect(doubles.orderAdminActionsRuntime).not.toHaveBeenCalled();
    });
    it('rejects a read-only staff member without invoking a mutation', async () => {
      doubles.requireAdminSession.mockResolvedValue({ ...actor, role: 'READ_ONLY' });
      expect((await input.handler(requestFor(input.body, input.method), context)).status).toBe(403);
      expect(doubles.orderAdminActionsRuntime).not.toHaveBeenCalled();
    });
    for (const body of [null, [], '{', {}, { ...input.body, unexpected: true }, ...input.invalid])
      it(`rejects malformed or unknown action data ${JSON.stringify(body)?.slice(0, 80)}`, async () => {
        expect((await input.handler(requestFor(body, input.method), context)).status).toBe(400);
        expect(doubles[input.service]).not.toHaveBeenCalled();
      });
    for (const invalidKey of [null, '', 'short', 'x'.repeat(121)])
      it(`rejects invalid idempotency key ${invalidKey?.length ?? 'missing'}`, async () => {
        expect(
          (await input.handler(requestFor(input.body, input.method, invalidKey), context)).status,
        ).toBe(400);
        expect(doubles[input.service]).not.toHaveBeenCalled();
      });
    for (const validKey of ['x'.repeat(12), 'x'.repeat(120)])
      it(`accepts the ${validKey.length}-character idempotency boundary`, async () => {
        expect(
          (await input.handler(requestFor(input.body, input.method, validKey), context)).status,
        ).toBe(200);
        expect(doubles[input.service].mock.calls[0]?.[1].idempotencyKey).toBe(validKey);
      });
    it('rejects an invalid display order number', async () => {
      const response = await input.handler(requestFor(input.body, input.method), {
        params: Promise.resolve({ orderNumber: '%E0%A4%A', returnId: uuid }),
      });
      expect(response.status).toBe(400);
      expect(doubles[input.service]).not.toHaveBeenCalled();
    });
    for (const [error, status] of [
      [new OrderAdminActionValidationError('Invalid fields.'), 400],
      [new OrderAdminActionAccessError('Denied.'), 403],
      [new OrderAdminActionNotFoundError('Order not found.'), 404],
      [new OrderAdminActionConflictError('State changed.'), 409],
    ] as const)
      it(`maps ${error.constructor.name} to ${status}`, async () => {
        doubles[input.service].mockRejectedValue(error);
        expect((await input.handler(requestFor(input.body, input.method), context)).status).toBe(
          status,
        );
      });
    it('returns refreshed eligibility for a stale action', async () => {
      const eligibility = { cancel: { eligible: false, reason: 'Already fulfilled' } };
      doubles[input.service].mockRejectedValue(
        new OrderAdminActionConflictError('State changed.', eligibility as never),
      );
      const response = await input.handler(requestFor(input.body, input.method), context);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'State changed.',
        code: 'ORDER_ACTION_CONFLICT',
        eligibility,
      });
    });
    it('returns a typed provider failure without leaking the raw message', async () => {
      doubles[input.service].mockRejectedValue(
        new FulfillmentIntegrationError('PROVIDER_ERROR', 'token=secret raw provider payload'),
      );
      const response = await input.handler(requestFor(input.body, input.method), context);
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.code).toBe('ORDER_PROVIDER_FAILURE');
      expect(JSON.stringify(data)).not.toMatch(/secret|payload/);
    });
    it('does not leak unexpected implementation errors', async () => {
      doubles[input.service].mockRejectedValue(new Error('database credentials=secret'));
      const response = await input.handler(requestFor(input.body, input.method), context);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('secret');
    });
    it('does not expose an unknown error merely because its message contains unavailable', async () => {
      doubles[input.service].mockRejectedValue(new Error('Provider unavailable: token=secret'));
      const response = await input.handler(requestFor(input.body, input.method), context);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('secret');
    });
  });
}
