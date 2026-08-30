import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    return NextResponse.json({
      cart: await (await commerceRuntime()).getCart(await requireSession(), cartId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
