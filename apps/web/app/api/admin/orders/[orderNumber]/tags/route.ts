import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { orderDetailRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const { orderNumber } = await context.params;
    const tags = await orderDetailRuntime().listOrderTags(await requireAdminSession(), orderNumber);
    return NextResponse.json({ tags });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ orderNumber: string }> }) {
  try {
    const body = (await request.json()) as { tags?: unknown };
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      return NextResponse.json({ error: 'Order tags must be strings.' }, { status: 400 });
    }
    const { orderNumber } = await context.params;
    const tags = await orderDetailRuntime().replaceOrderTags(
      await requireAdminSession(),
      orderNumber,
      body.tags as string[],
    );
    return NextResponse.json({ tags });
  } catch (error) {
    return handleRouteError(error);
  }
}
