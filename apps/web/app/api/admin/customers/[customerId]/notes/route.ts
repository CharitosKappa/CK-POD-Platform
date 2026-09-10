import { NextResponse } from 'next/server';

import { handleRouteError } from '../../../../../../lib/http';
import { customerOperationsRuntime, requireAdminSession } from '../../../../../../lib/platform';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { body?: unknown };
    if (typeof body.body !== 'string')
      return NextResponse.json({ error: 'Enter an internal note.' }, { status: 400 });
    const { customerId } = await context.params;
    await customerOperationsRuntime().addNote(await requireAdminSession(), customerId, body.body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
