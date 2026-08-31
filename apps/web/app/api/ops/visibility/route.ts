import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { cxOperationsRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await cxOperationsRuntime().visibility(await requireSession(false)));
  } catch (error) {
    return handleRouteError(error);
  }
}
