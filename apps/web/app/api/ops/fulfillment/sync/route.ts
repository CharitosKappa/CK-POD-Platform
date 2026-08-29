import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { fulfillmentRuntime, requireSession, services } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    const session = await requireSession(false);
    await services().fulfillmentAdmin.listProviderMatrix(session);
    const summary = await fulfillmentRuntime().catalogSync.sync(`ops-sync:${randomUUID()}`);
    return NextResponse.json({ sync: summary });
  } catch (error) {
    return handleRouteError(error);
  }
}
