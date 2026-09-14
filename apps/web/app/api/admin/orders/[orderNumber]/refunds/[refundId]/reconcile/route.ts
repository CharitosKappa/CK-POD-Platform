import { NextResponse } from 'next/server';
import { OrderAdminActionNotFoundError, type RefundOrderResult } from '@let-it-be/domain';

import { handleOrderActionRouteError as handleRouteError } from '../../../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../../../lib/platform';
import { actionRequest, object, uuid } from '../../../_actions/request';

export const dynamic = 'force-dynamic';

function reconciliationResponse(refund: RefundOrderResult) {
  const result = {
    refundId: refund.refundId,
    destination: refund.destination,
    amountCents: refund.amountCents,
    succeededAmountCents: refund.succeededAmountCents,
    failedAmountCents: refund.failedAmountCents,
    status: refund.status,
    duplicate: refund.duplicate,
  };
  if (refund.status === 'PARTIAL')
    return NextResponse.json(
      {
        error:
          'Only part of the refund completed. The remaining amount is available to refund again.',
        code: 'REFUND_PARTIAL',
        result,
      },
      { status: 409 },
    );
  return NextResponse.json({ result }, { status: refund.status === 'PENDING' ? 202 : 200 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderNumber: string; refundId: string }> },
) {
  try {
    const {
      session,
      body: raw,
      orderNumber,
      idempotencyKey,
    } = await actionRequest(request, context);
    object(raw, []);
    const refundId = uuid((await context.params).refundId);
    const { refunds } = await orderAdminActionsRuntime();
    const reconciled = await refunds.reconcileRefund(
      { type: 'STAFF', ...session },
      { orderNumber, refundId, idempotencyKey },
    );
    if (!reconciled) throw new OrderAdminActionNotFoundError('Refund not found.');
    return reconciliationResponse(reconciled);
  } catch (error) {
    return handleRouteError(error);
  }
}
