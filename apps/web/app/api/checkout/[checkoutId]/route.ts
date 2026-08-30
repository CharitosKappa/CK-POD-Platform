import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ checkoutId: string }> },
): Promise<NextResponse> {
  try {
    const { checkoutId } = await context.params;
    return NextResponse.json({
      checkout: await (await commerceRuntime()).getCheckout(await requireSession(), checkoutId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
