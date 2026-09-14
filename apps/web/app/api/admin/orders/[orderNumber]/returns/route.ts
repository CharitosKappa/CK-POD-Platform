import { handleOrderActionRouteError as handleRouteError } from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import {
  actionRequest,
  actionResult,
  object,
  reasonAndNote,
  boolean,
  integer,
  uuid,
  invalid,
  refreshActionConflict,
  type ActionContext,
} from '../_actions/request';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: ActionContext) {
  try {
    const {
      session,
      body: raw,
      orderNumber,
      idempotencyKey,
    } = await actionRequest(request, context);
    const body = object(raw, ['reasonCode', 'note', 'shippingRequired', 'items']);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100)
      invalid('Select return quantities.');
    const items = body.items.map((rawItem) => {
      const item = object(rawItem, ['orderItemId', 'quantity']);
      return { orderItemId: uuid(item.orderItemId), quantity: integer(item.quantity, 1, 99) };
    });
    if (new Set(items.map((item) => item.orderItemId.toLowerCase())).size !== items.length)
      invalid('Select each order item only once.');
    const input = {
      ...reasonAndNote(body),
      orderNumber,
      idempotencyKey,
      shippingRequired: boolean(body.shippingRequired),
      items,
    };
    const runtime = await orderAdminActionsRuntime();
    try {
      return actionResult(await runtime.actions.createReturn(session, input));
    } catch (error) {
      return refreshActionConflict(error, session, orderNumber, runtime.detail);
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
