import { NextResponse } from 'next/server';

import { operationalOrderViews, type OperationalOrderView } from '@let-it-be/domain';
import { handleRouteError } from '../../../../lib/http';
import { orderOperationsRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

/** Trusted-only manual review queue. It never returns private asset storage keys. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const search = new URL(request.url).searchParams;
    const state = search.get('state') ?? undefined;
    const view = search.get('view') ?? undefined;
    if (view && !operationalOrderViews.includes(view as OperationalOrderView))
      return NextResponse.json({ error: 'Unsupported order view.' }, { status: 400 });
    const orders = await (
      await orderOperationsRuntime()
    ).listReviewQueue(await requireSession(false), {
      ...(state ? { state: state as never } : {}),
      ...(view ? { view: view as OperationalOrderView } : {}),
    });
    return NextResponse.json({ orders });
  } catch (error) {
    return handleRouteError(error);
  }
}
