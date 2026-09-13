import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
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
    const cursor = url.searchParams.get('cursor');
    const { orderNumber } = await context.params;
    const timeline = await orderDetailRuntime().listTimeline(
      await requireAdminSession(),
      orderNumber,
      { limit, ...(cursor ? { cursor } : {}) },
    );
    return NextResponse.json(timeline);
  } catch (error) {
    return handleRouteError(error);
  }
}
