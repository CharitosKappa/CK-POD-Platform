import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { orderOperationsRuntime, requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

/** Operational work queues only; commercial analytics remain on their own endpoint. */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({
      overview: await (
        await orderOperationsRuntime()
      ).getOperationsDashboard(await requireSession(false)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
