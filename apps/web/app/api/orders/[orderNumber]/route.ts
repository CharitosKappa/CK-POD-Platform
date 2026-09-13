import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { decodeOrderNumberRouteParam } from '../../../../lib/order-number-route';
import { commerceRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  try {
    const { orderNumber: routeOrderNumber } = await context.params;
    const orderNumber = decodeOrderNumberRouteParam(routeOrderNumber);
    const order = await (await commerceRuntime()).getOrder(await requireSession(), orderNumber);
    return order
      ? NextResponse.json({ order })
      : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
