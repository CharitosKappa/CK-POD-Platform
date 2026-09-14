import { handleOrderActionRouteError as handleRouteError } from '../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../lib/platform';
import {
  actionRequest,
  actionResult,
  object,
  reasonAndNote,
  type ActionContext,
} from '../_actions/request';
export const dynamic = 'force-dynamic';
async function changeArchive(request: Request, context: ActionContext, archived: boolean) {
  try {
    const { session, body, orderNumber, idempotencyKey } = await actionRequest(request, context);
    const fields = reasonAndNote(object(body, ['reasonCode', 'note']));
    const { actions } = await orderAdminActionsRuntime();
    return actionResult(
      await actions[archived ? 'archive' : 'unarchive'](session, {
        ...fields,
        orderNumber,
        idempotencyKey,
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
export async function POST(request: Request, context: ActionContext) {
  return changeArchive(request, context, true);
}
export async function DELETE(request: Request, context: ActionContext) {
  return changeArchive(request, context, false);
}
