import { returnStates } from '@let-it-be/domain';
import { handleOrderActionRouteError as handleRouteError } from '../../../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../../../lib/platform';
import {
  actionRequest,
  actionResult,
  object,
  optionalText,
  choice,
  uuid,
  refreshActionConflict,
} from '../../../_actions/request';
export const dynamic = 'force-dynamic';
export async function POST(
  request: Request,
  context: { params: Promise<{ orderNumber: string; returnId: string }> },
) {
  try {
    const {
      session,
      body: raw,
      orderNumber,
      idempotencyKey,
    } = await actionRequest(request, context);
    const body = object(raw, ['toState', 'carrier', 'trackingNumber', 'note']);
    const returnId = uuid((await context.params).returnId);
    const carrier = optionalText(body.carrier, 'carrier', 120);
    const trackingNumber = optionalText(body.trackingNumber, 'tracking number', 200);
    const note = optionalText(body.note, 'internal note');
    const runtime = await orderAdminActionsRuntime();
    try {
      return actionResult(
        await runtime.actions.transitionReturn(session, {
          orderNumber,
          idempotencyKey,
          returnId,
          toState: choice(body.toState, returnStates),
          ...(carrier === undefined ? {} : { carrier }),
          ...(trackingNumber === undefined ? {} : { trackingNumber }),
          ...(note === undefined ? {} : { note }),
        }),
      );
    } catch (error) {
      return refreshActionConflict(error, session, orderNumber, runtime.detail);
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
