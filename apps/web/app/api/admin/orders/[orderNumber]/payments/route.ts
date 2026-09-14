import { handleOrderActionRouteError } from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import { actionRequest, actionResult, object, uuid, type ActionContext } from '../_actions/request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: ActionContext) {
  try {
    const {
      session,
      body: raw,
      orderNumber,
      idempotencyKey,
    } = await actionRequest(request, context);
    const body = object(raw, ['orderRevisionId']);
    const payment = await (
      await orderAdminActionsRuntime()
    ).editPayments.prepare(session, {
      orderNumber,
      orderRevisionId: uuid(body.orderRevisionId),
      idempotencyKey,
    });
    return actionResult({
      paymentAttemptId: payment.paymentAttemptId,
      orderRevisionId: payment.orderRevisionId,
      status: payment.status,
      amountCents: payment.amountCents,
      currency: payment.currency,
      clientSecret: payment.clientSecret,
      duplicate: payment.duplicate,
    });
  } catch (error) {
    return handleOrderActionRouteError(error);
  }
}
