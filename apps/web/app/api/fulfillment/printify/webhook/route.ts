import { NextResponse } from 'next/server';

import { fulfillmentRuntime } from '../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const result = await fulfillmentRuntime().catalogSync.ingestWebhook({
      body: await request.text(),
      signature: request.headers.get('x-pfy-signature'),
    });
    return NextResponse.json({ accepted: true, duplicate: result.duplicate });
  } catch {
    return NextResponse.json({ error: 'Webhook could not be accepted.' }, { status: 401 });
  }
}
