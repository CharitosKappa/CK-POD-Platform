import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const { customerId } = await context.params;
    const customer = await customerOperationsRuntime().getCustomer(
      await requireAdminSession(),
      customerId,
    );
    return NextResponse.json({ customer });
  } catch (error) {
    return handleRouteError(error);
  }
}
