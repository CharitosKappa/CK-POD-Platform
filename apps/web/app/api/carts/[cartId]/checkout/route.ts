import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    const body = (await request.json()) as { addressId?: string; idempotencyKey?: string };
    if (!body.addressId || !body.idempotencyKey)
      return NextResponse.json(
        { error: 'Shipping address and checkout key are required.' },
        { status: 400 },
      );
    return NextResponse.json(
      {
        checkout: await commerceRuntime().startCheckout(
          await requireSession(),
          cartId,
          body.addressId,
          body.idempotencyKey,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
