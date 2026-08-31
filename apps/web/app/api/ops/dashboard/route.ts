import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { cxOperationsRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
    const from = url.searchParams.get('from')
      ? new Date(url.searchParams.get('from')!)
      : new Date(to.getTime() - 30 * 86_400_000);
    const service = cxOperationsRuntime();
    const session = await requireSession(false);
    const [metrics, report] = await Promise.all([
      service.dashboard(session, from, to),
      service.analyticsReport(session, from, to),
    ]);
    return NextResponse.json({ metrics, ...report });
  } catch (error) {
    return handleRouteError(error);
  }
}
