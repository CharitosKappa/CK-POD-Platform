import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  try {
    const { orderNumber } = await context.params;
    const order = await (await commerceRuntime()).getOrder(await requireSession(), orderNumber);
    return order
      ? NextResponse.json({ order })
      : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
