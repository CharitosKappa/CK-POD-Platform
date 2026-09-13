import { NextResponse } from 'next/server';
import { handleRouteError } from '../../../../../lib/http';
import { orderDetailRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const { orderNumber } = await context.params;
    const order = await orderDetailRuntime().getOrder(await requireAdminSession(), orderNumber);
    return order
      ? NextResponse.json({ order })
      : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
