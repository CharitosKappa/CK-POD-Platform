import { NextResponse } from 'next/server';
import { handleOrderActionRouteError as handleRouteError } from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import {
  actionRequest,
  actionResult,
  object,
  text,
  optionalText,
  boolean,
  choice,
  integer,
  uuid,
  invalid,
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
    const body = object(raw, [
      'cancellationId',
      'reasonCode',
      'refundDestination',
      'refundAmountCents',
      'staffNote',
      'notifyCustomer',
    ]);
    let input;
    if ('cancellationId' in body) {
      object(body, ['cancellationId']);
      input = { orderNumber, idempotencyKey, cancellationId: uuid(body.cancellationId) };
    } else {
      const refundDestination = choice(body.refundDestination, [
        'ORIGINAL_PAYMENT',
        'STORE_CREDIT',
        'LATER',
      ]);
      const refundAmountCents = integer(
        body.refundAmountCents,
        refundDestination === 'LATER' ? 0 : 1,
      );
      if (refundDestination === 'LATER' && refundAmountCents !== 0)
        invalid('Refund later must have a zero amount.');
      const staffNote = optionalText(body.staffNote, 'internal note');
      input = {
        orderNumber,
        idempotencyKey,
        refundDestination,
        refundAmountCents,
        reasonCode: text(body.reasonCode, 'reason'),
        notifyCustomer: boolean(body.notifyCustomer),
        ...(staffNote === undefined ? {} : { staffNote }),
      };
    }
    const { actions } = await orderAdminActionsRuntime();
    const result =
      'cancellationId' in input
        ? await actions.retryCancellation(session, input)
        : await actions.cancel(session, input);
    if (result.status === 'PARTIAL' || result.status === 'FAILED')
      return NextResponse.json(
        {
          error:
            'Cancellation is incomplete. Review the unresolved printing groups before retrying.',
          code: 'CANCELLATION_INCOMPLETE',
          result,
        },
        { status: 409 },
      );
    return actionResult(
      result,
      result.status === 'REQUESTED' || result.status === 'PROCESSING' ? 202 : 200,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
