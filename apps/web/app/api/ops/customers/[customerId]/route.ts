import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { customerOperationsRuntime, requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const { customerId } = await context.params;
    const customer = await customerOperationsRuntime().getCustomer(
      await requireSession(false),
      customerId,
    );
    return NextResponse.json({ customer });
  } catch (error) {
    return handleRouteError(error);
  }
}
