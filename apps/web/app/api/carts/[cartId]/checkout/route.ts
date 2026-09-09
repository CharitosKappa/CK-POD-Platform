import { NextResponse } from 'next/server';

import { operationalCapability } from '@let-it-be/config';
import { createLogger, parseLogLevel } from '@let-it-be/observability';
import { handleRouteError } from '../../../../../lib/http';
import { commerceRuntime, requireSession } from '../../../../../lib/platform';
import { enforceRateLimit } from '../../../../../lib/security';
import { serverEnvironment } from '../../../../../lib/runtime-environment';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ cartId: string }> },
): Promise<NextResponse> {
  try {
    const capability = operationalCapability(serverEnvironment(), 'CHECKOUT_CREATION');
    if (!capability.enabled)
      return NextResponse.json({ error: capability.message }, { status: 503 });
    const { cartId } = await context.params;
    const session = await requireSession();
    await enforceRateLimit(request, {
      action: 'checkout',
      subject: session.userId ?? session.id,
      maxRequests: 10,
      windowMs: 15 * 60_000,
    });
    const body = (await request.json()) as {
      shippingAddressId?: string;
      billingAddress?: {
        recipientName?: string;
        line1?: string;
        line2?: string;
        city?: string;
        stateCode?: string;
        postalCode?: string;
        countryCode?: string;
      } | null;
      idempotencyKey?: string;
    };
    if (!body.shippingAddressId || !body.idempotencyKey || body.billingAddress === undefined)
      return NextResponse.json(
        { error: 'Shipping address, billing choice, and checkout key are required.' },
        { status: 400 },
      );
    if (
      body.billingAddress !== null &&
      (typeof body.billingAddress.recipientName !== 'string' ||
        typeof body.billingAddress.line1 !== 'string' ||
        typeof body.billingAddress.city !== 'string' ||
        typeof body.billingAddress.stateCode !== 'string' ||
        typeof body.billingAddress.postalCode !== 'string' ||
        typeof body.billingAddress.countryCode !== 'string' ||
        (body.billingAddress.line2 !== undefined && typeof body.billingAddress.line2 !== 'string'))
    ) {
      return NextResponse.json(
        { error: 'Complete billing address details are required.' },
        { status: 400 },
      );
    }
    const checkout = await (
      await commerceRuntime()
    ).startCheckout(session, cartId, {
      shippingAddressId: body.shippingAddressId,
      billingAddress:
        body.billingAddress === null
          ? null
          : {
              recipientName: body.billingAddress.recipientName as string,
              line1: body.billingAddress.line1 as string,
              ...(body.billingAddress.line2 === undefined
                ? {}
                : { line2: body.billingAddress.line2 }),
              city: body.billingAddress.city as string,
              stateCode: body.billingAddress.stateCode as string,
              postalCode: body.billingAddress.postalCode as string,
              countryCode: body.billingAddress.countryCode as string,
            },
      idempotencyKey: body.idempotencyKey,
    });
    createLogger({ service: 'web', minimumLevel: parseLogLevel(process.env.LOG_LEVEL) }).info(
      'checkout.created',
      { requestId: request.headers.get('x-request-id'), cartId, checkoutId: checkout.id },
    );
    return NextResponse.json({ checkout }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
