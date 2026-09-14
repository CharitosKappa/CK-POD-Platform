import { handleOrderActionRouteError } from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import { serverEnvironment } from '../../../../../../lib/runtime-environment';
import {
  actionRequest,
  actionResult,
  object,
  readOrderActionRequest,
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
    object(raw, []);
    const payment = await (
      await orderAdminActionsRuntime()
    ).editPayments.prepare(session, {
      orderNumber,
      idempotencyKey,
    });
    return actionResult(publicPayment(payment));
  } catch (error) {
    return handleOrderActionRouteError(error);
  }
}

export async function GET(_request: Request, context: ActionContext) {
  try {
    const { session, orderNumber } = await readOrderActionRequest(context);
    const payment = await (
      await orderAdminActionsRuntime()
    ).editPayments.readOrRecover(session, { orderNumber });
    return actionResult(payment ? publicPayment(payment) : null);
  } catch (error) {
    return handleOrderActionRouteError(error);
  }
}

function publicPayment(payment: {
  paymentAttemptId: string;
  orderRevisionId: string;
  status: string;
  amountCents: number;
  currency: string;
  clientSecret: string | null;
  collectionAllowed: boolean;
  duplicate: boolean;
}) {
  const environment = serverEnvironment();
  return {
    paymentAttemptId: payment.paymentAttemptId,
    orderRevisionId: payment.orderRevisionId,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    clientSecret: payment.collectionAllowed ? payment.clientSecret : null,
    collectionAllowed: payment.collectionAllowed,
    duplicate: payment.duplicate,
    developmentSimulationAvailable:
      payment.collectionAllowed &&
      environment.PAYMENT_ADAPTER === 'fake' &&
      ['local', 'test'].includes(environment.APP_ENV),
  };
}
