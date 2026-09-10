import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { orderOperationsRuntime, requireSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

/** Operations-only group read model; customer order reads remain aggregated. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ orderNumber: string }> },
): Promise<NextResponse> {
  try {
    const { orderNumber } = await context.params;
    const groups = await (
      await orderOperationsRuntime()
    ).listFulfillmentGroups(await requireSession(false), orderNumber);
    return NextResponse.json({ groups });
  } catch (error) {
    return handleRouteError(error);
  }
}
