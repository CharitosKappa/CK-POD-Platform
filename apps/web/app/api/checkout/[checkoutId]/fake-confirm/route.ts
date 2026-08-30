import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

/** Deterministic development/CI payment control. It is unavailable when Stripe is configured. */
export async function POST(
  request: Request,
  context: { params: Promise<{ checkoutId: string }> },
): Promise<NextResponse> {
  try {
    if ((process.env.PAYMENT_ADAPTER ?? 'fake') !== 'fake')
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const { checkoutId } = await context.params;
    const body = (await request.json()) as {
      outcome?: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING';
    };
    const result = await commerceRuntime().simulateFakePayment(
      await requireSession(),
      checkoutId,
      body.outcome ?? 'SUCCEEDED',
    );
    return NextResponse.json({ ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
