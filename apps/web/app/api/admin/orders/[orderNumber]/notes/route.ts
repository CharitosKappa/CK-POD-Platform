import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { orderDetailRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const body = (await request.json()) as { body?: unknown };
    if (typeof body.body !== 'string') {
      return NextResponse.json({ error: 'Enter an order note.' }, { status: 400 });
    }
    const { orderNumber } = await context.params;
    const note = await orderDetailRuntime().addOrderNote(
      await requireAdminSession(),
      orderNumber,
      body.body,
    );
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
