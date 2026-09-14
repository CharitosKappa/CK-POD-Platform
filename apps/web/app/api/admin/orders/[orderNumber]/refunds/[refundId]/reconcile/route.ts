import { NextResponse } from 'next/server';
import { OrderAdminActionNotFoundError, type RefundOrderResult } from '@let-it-be/domain';

import { handleOrderActionRouteError as handleRouteError } from '../../../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../../../lib/platform';
import { actionRequest, object, uuid } from '../../../_actions/request';

export const dynamic = 'force-dynamic';

function reconciliationResponse(refund: RefundOrderResult) {
  return NextResponse.json(
    {
      result: {
        refundId: refund.refundId,
        destination: refund.destination,
        amountCents: refund.amountCents,
        status: refund.status,
        duplicate: refund.duplicate,
      },
    },
    { status: refund.status === 'PENDING' ? 202 : 200 },
  );
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
