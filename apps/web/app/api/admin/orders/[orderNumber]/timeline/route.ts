import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { decodeOrderNumberRouteParam } from '../../../../../../lib/order-number-route';
import { orderDetailRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ orderNumber: string }> }) {
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 10 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return NextResponse.json(
        { error: 'Timeline limit must be between 1 and 50.' },
        { status: 400 },
      );
    }
    const rawPage = url.searchParams.get('page');
    const page = rawPage === null ? 1 : Number(rawPage);
    if (!Number.isInteger(page) || page < 1) {
      return NextResponse.json(
        { error: 'Timeline page must be a positive integer.' },
        { status: 400 },
      );
    }
    const { orderNumber: routeOrderNumber } = await context.params;
    const orderNumber = decodeOrderNumberRouteParam(routeOrderNumber);
    const timeline = await orderDetailRuntime().listTimeline(
      await requireAdminSession(),
      orderNumber,
      { limit, page },
    );
    return NextResponse.json(timeline);
  } catch (error) {
    return handleRouteError(error);
  }
}
