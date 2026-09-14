import { NextResponse } from 'next/server';
import { OrderAdminActionNotFoundError, type RefundOrderResult } from '@let-it-be/domain';
import {
  handleOrderActionRouteError as handleRouteError,
  handleOrderRefundRouteError,
} from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import {
  actionRequest,
  actionResult,
  object,
  reasonAndNote,
  choice,
  integer,
  type ActionContext,
} from '../_actions/request';
export const dynamic = 'force-dynamic';
function refundResponse(refund: RefundOrderResult) {
  const result = {
    refundId: refund.refundId,
    destination: refund.destination,
    amountCents: refund.amountCents,
    status: refund.status,
    duplicate: refund.duplicate,
  };
  if (result.status === 'FAILED')
    return NextResponse.json(
      {
        error: 'The refund was not completed. Review its status before retrying.',
        code: 'REFUND_FAILED',
        result,
      },
      { status: 409 },
    );
  return actionResult(result, result.status === 'PENDING' ? 202 : 200);
}
export async function POST(request: Request, context: ActionContext) {
  try {
    const {
      session,
      body: raw,
      orderNumber,
      idempotencyKey,
    } = await actionRequest(request, context);
    const body = object(raw, ['destination', 'amountCents', 'reasonCode', 'note']);
    const destination = choice(body.destination, ['ORIGINAL_PAYMENT', 'STORE_CREDIT']);
    const fields = reasonAndNote(body);
    choice(fields.reasonCode, [
      'CUSTOMER_REQUEST',
      'DUPLICATE_CHARGE',
      'PRODUCTION_DEFECT',
      'CANCELLED',
    ]);
    const input = {
      ...fields,
      orderNumber,
      idempotencyKey,
      amountCents: integer(body.amountCents, 1),
    };
    const { refunds, detail } = await orderAdminActionsRuntime();
    if (!(await detail.getOrder(session, orderNumber)))
      throw new OrderAdminActionNotFoundError('Order not found.');
    const refundActor = {
      type: 'STAFF' as const,
      staffMemberId: session.staffMemberId,
      role: session.role,
      email: session.email,
    };
    try {
      const refund = await refunds[
        destination === 'ORIGINAL_PAYMENT' ? 'refundOriginalPayment' : 'refundToStoreCredit'
      ](refundActor, input);
      return refundResponse(refund);
    } catch (error) {
      try {
        const recovered = await refunds.recoverRefundResult(refundActor, input);
        if (recovered) return refundResponse(recovered);
      } catch {
        // Do not repeat the mutation if recovery storage is temporarily unavailable.
      }
      const response = handleOrderRefundRouteError(error);
      if (response.status === 409) {
        const payload = (await response.clone().json()) as {
          code?: string;
          eligibility?: unknown;
        };
        if (payload.code === 'ORDER_ACTION_CONFLICT' && !payload.eligibility) {
          try {
            const refreshed = await detail.getOrder(session, orderNumber);
            if (refreshed)
              return NextResponse.json(
                { ...payload, eligibility: refreshed.eligibility },
                { status: 409 },
              );
          } catch {
            // The mutation conflict remains authoritative if the read refresh fails.
          }
        }
      }
      return response;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
