import { NextResponse } from 'next/server';

import { fulfillmentRuntime, orderOperationsRuntime } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-pfy-signature');
    const result = await fulfillmentRuntime().catalogSync.ingestWebhook({ body, signature });
    await (await orderOperationsRuntime()).ingestFulfillmentWebhook({ body, signature });
    return NextResponse.json({ accepted: true, duplicate: result.duplicate });
  } catch {
    return NextResponse.json({ error: 'Webhook could not be accepted.' }, { status: 401 });
  }
}
