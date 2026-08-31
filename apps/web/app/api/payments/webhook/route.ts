import { NextResponse } from 'next/server';

import { createLogger, parseLogLevel } from '@let-it-be/observability';
import { commerceRuntime } from '../../../../lib/platform';

export const dynamic = 'force-dynamic';

/** The authoritative payment boundary. It cannot create or submit a fulfillment order. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const result = await (
      await commerceRuntime()
    ).ingestPaymentWebhook({
      body: await request.text(),
      signature:
        request.headers.get('stripe-signature') ?? request.headers.get('x-fake-payment-signature'),
    });
    createLogger({ service: 'web', minimumLevel: parseLogLevel(process.env.LOG_LEVEL) }).info(
      'payment.webhook_processed',
      {
        requestId: request.headers.get('x-request-id'),
        orderNumber: result.orderNumber,
        duplicate: result.duplicate,
      },
    );
    return NextResponse.json({
      accepted: true,
      duplicate: result.duplicate,
      orderNumber: result.orderNumber,
    });
  } catch {
    return NextResponse.json({ error: 'Payment webhook could not be accepted.' }, { status: 401 });
  }
}
