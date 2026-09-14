import { NextResponse } from 'next/server';

import { handleOrderActionRouteError } from '../../../../../../../lib/http';
import { orderAdminActionsRuntime } from '../../../../../../../lib/platform';
import { serverEnvironment } from '../../../../../../../lib/runtime-environment';
import { actionResult, readOrderActionRequest, type ActionContext } from '../../_actions/request';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: ActionContext) {
  try {
    const environment = serverEnvironment();
    if (environment.PAYMENT_ADAPTER !== 'fake' || !['local', 'test'].includes(environment.APP_ENV))
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const { session, orderNumber } = await readOrderActionRequest(context);
    const result = await (
      await orderAdminActionsRuntime()
    ).editPayments.simulateFakeSuccess(session, { orderNumber });
    return actionResult({ status: result.status });
  } catch (error) {
    return handleOrderActionRouteError(error);
  }
}
