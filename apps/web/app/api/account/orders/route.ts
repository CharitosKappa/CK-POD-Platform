import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { requireSession, services } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ orders: await services().account.orders(await requireSession(false)) });
  } catch (error) {
    return handleRouteError(error);
  }
}
