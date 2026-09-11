import { NextResponse } from 'next/server';
import { handleRouteError } from '../../../../../lib/http';
import {
  adminCommerceRuntime,
  orderOperationsRuntime,
  requireAdminSession,
} from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const { orderNumber } = await context.params;
    const session = await requireAdminSession();
    const [commerce, operations] = await Promise.all([
      adminCommerceRuntime().getOrder(session, orderNumber),
      (await orderOperationsRuntime()).getOperationalOrder(session, orderNumber),
    ]);
    return commerce && operations
      ? NextResponse.json({ order: { ...operations, ...commerce } })
      : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
