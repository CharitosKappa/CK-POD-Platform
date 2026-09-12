import { NextResponse } from 'next/server';
import { detectCustomerLocale } from '@let-it-be/domain';

import { handleRouteError } from '../../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const { cartId } = await context.params;
    const body = (await request.json()) as Record<string, string | boolean | undefined>;
    const addressId = await (
      await commerceRuntime()
    ).saveShippingAddress(await requireSession(), cartId, {
      recipientName: typeof body.recipientName === 'string' ? body.recipientName : '',
      email: typeof body.email === 'string' ? body.email : '',
      line1: typeof body.line1 === 'string' ? body.line1 : '',
      city: typeof body.city === 'string' ? body.city : '',
      stateCode: typeof body.stateCode === 'string' ? body.stateCode : '',
      postalCode: typeof body.postalCode === 'string' ? body.postalCode : '',
      countryCode: typeof body.countryCode === 'string' ? body.countryCode : 'US',
      ...(typeof body.phone === 'string' && body.phone ? { phone: body.phone } : {}),
      ...(typeof body.line2 === 'string' && body.line2 ? { line2: body.line2 } : {}),
      ...(body.saveToAccount === true ? { saveToAccount: true } : {}),
      preferredLocale: detectCustomerLocale(request.headers.get('accept-language')),
    });
    return NextResponse.json({ addressId }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
