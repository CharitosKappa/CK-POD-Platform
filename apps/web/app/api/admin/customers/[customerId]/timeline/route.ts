import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    const { customerId } = await context.params;
    const search = new URL(request.url).searchParams;
    const timeline = await customerOperationsRuntime().listCustomerTimeline(session, customerId, {
      page: Number(search.get('page') ?? '1'),
      limit: Number(search.get('limit') ?? '10'),
    });
    return NextResponse.json({ timeline });
  } catch (error) {
    return handleRouteError(error);
  }
}
