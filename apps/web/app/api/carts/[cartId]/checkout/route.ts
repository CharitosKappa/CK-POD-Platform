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
    const body = (await request.json()) as { addressId?: string; idempotencyKey?: string };
    if (!body.addressId || !body.idempotencyKey)
      return NextResponse.json(
        { error: 'Shipping address and checkout key are required.' },
        { status: 400 },
      );
    const checkout = await (
      await commerceRuntime()
    ).startCheckout(session, cartId, body.addressId, body.idempotencyKey);
    createLogger({ service: 'web', minimumLevel: parseLogLevel(process.env.LOG_LEVEL) }).info(
      'checkout.created',
      { requestId: request.headers.get('x-request-id'), cartId, checkoutId: checkout.id },
    );
    return NextResponse.json({ checkout }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
