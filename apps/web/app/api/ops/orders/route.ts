import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { orderOperationsRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

/** Trusted-only manual review queue. It never returns private asset storage keys. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const state = new URL(request.url).searchParams.get('state') ?? undefined;
    const orders = await (
      await orderOperationsRuntime()
    ).listReviewQueue(await requireSession(false), {
      ...(state ? { state: state as never } : {}),
    });
    return NextResponse.json({ orders });
  } catch (error) {
    return handleRouteError(error);
  }
}
