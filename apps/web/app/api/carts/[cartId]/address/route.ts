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
    const body = (await request.json()) as Record<string, string | undefined>;
    const addressId = await (
      await commerceRuntime()
    ).saveShippingAddress(await requireSession(), cartId, {
      recipientName: body.recipientName ?? '',
      email: body.email ?? '',
      line1: body.line1 ?? '',
      city: body.city ?? '',
      stateCode: body.stateCode ?? '',
      postalCode: body.postalCode ?? '',
      countryCode: body.countryCode ?? 'US',
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.line2 ? { line2: body.line2 } : {}),
    });
    return NextResponse.json({ addressId }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
