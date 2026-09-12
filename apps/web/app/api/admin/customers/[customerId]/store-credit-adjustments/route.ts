import { NextResponse } from 'next/server';

import type { StoreCreditAdjustmentInput } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../../lib/http';
import { requireAdminSession, storeCreditRuntime } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    const { customerId } = await context.params;
    const body = (await request.json()) as StoreCreditAdjustmentInput;
    const adjustment = await storeCreditRuntime().adjust(session, customerId, body);
    return NextResponse.json({ adjustment });
  } catch (error) {
    return handleRouteError(error);
  }
}
